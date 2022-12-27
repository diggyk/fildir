import * as vscode from "vscode";
import { Uri } from "vscode";
import * as fs from "fs";
import * as path from "path";
import { create } from "domain";
import { join } from "path";

const filters = [
	"disco/",
	"oms/helm/",
];

/// Provides both the filesystem implementation, so we can add filtered view in the file explorer,
/// and a tree view so we can set up an editable view of globss
export class FilteredDirectoryProvider
	implements vscode.FileSystemProvider, vscode.TreeDataProvider<Uri> {

	constructor() {
		this.rebuildRootNodes();
	}

	/// map of workspace name and root path
	private rootNodes: Map<string, string> = new Map();
	private rebuildTime = Date.now();


	// We rebuild our root nodes by taking a look at our open workspace folders and adding them as top-level
	// directories under the filtered directories view
	rebuildRootNodes() {
		this.rebuildTime = Date.now();
		this.rootNodes = new Map();

		// if we don't have any workspace folders open at all, we have nothing to do
		if (!vscode.workspace.workspaceFolders) {
			return;
		}

		for (const workspaceRoot of vscode.workspace.workspaceFolders) {
			// we only support local file systems
			if (workspaceRoot.uri.scheme !== "file") { continue; }

			this.rootNodes.set(
				workspaceRoot.name, workspaceRoot.uri.path
			);
		}

		// if we have 0 roots, we should remove ourselves as well
		if (this.rootNodes.size === 0) { vscode.workspace.updateWorkspaceFolders(0, vscode.workspace.workspaceFolders.length); }
	}

	/// takes a path that's given and converts it to a file system path based on workspace root
	/// and also gives us the "subpath" which is the relative path to the file where we should find it
	/// if it exists under a workspace root folder
	convertPath(path: string): string[] {
		if (path[0] === '/') {
			path = path.substring(1);
		}

		let segments = path.split('/');
		if (!this.rootNodes.has(segments[0])) {
			throw vscode.FileSystemError.FileNotFound("Fildir could not parse path: " + path);
		}

		let subpath = segments.slice(1).join('/');

		return [this.rootNodes.get(segments[0]) + "/" + subpath, subpath];
	}

	/// See if our path is a prefix to one of our filters
	prefixOfFilter(subpath: string): boolean {
		let prefixOfFilter = false;
		for (const filter of filters) {
			if (filter.startsWith(subpath + "/")) {
				prefixOfFilter = true;
			}
		}
		return prefixOfFilter;
	}

	/// check is a subpath is prefixed by one of our filters
	subpathMatchesFilter(subpath: string): boolean {
		if (!subpath.endsWith('/')) {
			subpath = subpath + "/";
		}

		let matchesFilter = false;
		for (const filter of filters) {
			if (subpath.startsWith(filter)) {
				matchesFilter = true;
			}

		}
		return matchesFilter;
	}

	/// when the workspaces change, we want to either move our workspace folder to the end or remove
	/// it all together if we don't have any other folders. 
	workspacesChanged(_event: vscode.WorkspaceFoldersChangeEvent) {
		let folders = vscode.workspace.workspaceFolders;

		// no folders means we have nothing to do b/c we don't want our folder if no
		// actual folders are mounted
		if (!folders) {
			return;
		}

		// filter out our folder
		let newOrder: any[] = [];
		if (folders) {
			for (const folder of folders) {
				if (folder.uri.scheme !== "fildir") {
					newOrder.push({ uri: folder.uri, name: folder.name });
				}
			}
		}

		// if we are left with no folders after filtering out ours, delete them all
		if (newOrder.length === 0) {

			vscode.workspace.updateWorkspaceFolders(0, folders.length);
			return;
		}

		// add out folder at the end
		newOrder.push({ uri: vscode.Uri.parse('fildir:/'), name: "Filtered View" });
		vscode.workspace.updateWorkspaceFolders(0, folders.length, ...newOrder);
	}


	private _treeemitter = new vscode.EventEmitter<Uri | undefined | void>();
	readonly onDidChangeTreeData = this._treeemitter.event;
	getTreeItem(element: Uri): vscode.TreeItem | Thenable<vscode.TreeItem> {
		return new vscode.TreeItem(element.path);
	}
	getChildren(element?: Uri | undefined): vscode.ProviderResult<Uri[]> {
		return [];
	}

	/// We use this to tell VSCode to reexamine our root
	private _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
	readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._onDidChangeFile.event;

	watch(uri: vscode.Uri, options: { readonly recursive: boolean; readonly excludes: readonly string[]; }): vscode.Disposable {
		return new vscode.Disposable(() => { });
	}

	stat(uri: vscode.Uri): vscode.FileStat | Thenable<vscode.FileStat> {
		if (uri.path === "/") {
			return {
				ctime: this.rebuildTime,
				mtime: this.rebuildTime,
				permissions: vscode.FilePermission.Readonly,
				size: 0,
				type: vscode.FileType.Directory,
			};
		}

		let [path, subpath] = this.convertPath(uri.path);

		return vscode.workspace.fs.stat(Uri.file(path));

	}

	readDirectory(uri: vscode.Uri): [string, vscode.FileType][] | Thenable<[string, vscode.FileType][]> {
		// if VSCode is asking about our root, let's rebuild it now
		if (uri.path === "/") {
			this.rebuildRootNodes();
			let roots: [string, vscode.FileType][] = [];
			for (const rootNode of this.rootNodes) {
				roots.push([rootNode[0], vscode.FileType.Directory]);
			}
			return roots;
		}

		let [path, subpath] = this.convertPath(uri.path);


		// if the directory we want to read starts with one of our prefix filters, than we want to display it
		let matchesFilter = this.subpathMatchesFilter(subpath);


		return vscode.workspace.fs.readDirectory(Uri.file(path)).then(finds => {
			let items: [string, vscode.FileType][] = [];
			for (const found of finds) {

				if (matchesFilter) {
					// because our directory matched a filter, we can display all items
					items.push(found);
				} else {
					// our directory itself didn't match a filter, but one of the subdirs might be
					// a prefix of one of our filters, meaning it is part of the path to get to our
					// desired filtered directory
					let testpath = subpath.trim().length > 0 ? subpath + "/" + found[0] : found[0];

					if (found[1] === vscode.FileType.Directory && this.prefixOfFilter(testpath)) {
						items.push(found);
					}
				}
			}

			return items;
		});
	}

	createDirectory(uri: vscode.Uri): void | Thenable<void> {
		let [path, subpath] = this.convertPath(uri.path);
		return vscode.workspace.fs.createDirectory(Uri.file(path));
	}

	readFile(uri: vscode.Uri): Uint8Array | Thenable<Uint8Array> {
		let [path, subpath] = this.convertPath(uri.path);
		return vscode.workspace.fs.readFile(Uri.file(path));
	}

	writeFile(uri: vscode.Uri, content: Uint8Array, options: { readonly create: boolean; readonly overwrite: boolean; }): void | Thenable<void> {
		let [path, subpath] = this.convertPath(uri.path);
		return vscode.workspace.fs.writeFile(Uri.file(path), content);
	}

	delete(uri: vscode.Uri, options: { readonly recursive: boolean; }): void | Thenable<void> {
		let [path, subpath] = this.convertPath(uri.path);
		return vscode.workspace.fs.delete(Uri.file(path), options);
	}

	rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { readonly overwrite: boolean; }): void | Thenable<void> {
		let [oldpath, oldsubpath] = this.convertPath(oldUri.path);
		let [newpath, newsubpath] = this.convertPath(newUri.path);
		return vscode.workspace.fs.rename(Uri.file(oldpath), Uri.file(newpath), options);
	}

	copy(source: vscode.Uri, destination: vscode.Uri, options: { readonly overwrite: boolean; }): void | Thenable<void> {
		throw new Error("Method not implemented.");
	}


	public openClickedItem(path: string) {
		console.debug("Open " + path);
		vscode.workspace.openTextDocument(path).then(document => {
			vscode.window.showTextDocument(document, { preview: false });
		});
	}
}

export function activate(context: vscode.ExtensionContext) {
	const filDirProvider = new FilteredDirectoryProvider();

	context.subscriptions.push(vscode.workspace.registerFileSystemProvider("fildir", filDirProvider, { isCaseSensitive: true }));
	context.subscriptions.push(vscode.window.registerTreeDataProvider("fildir", filDirProvider));
	context.subscriptions.push(vscode.commands.registerCommand('open_clicked_item', fullpath => filDirProvider.openClickedItem(fullpath)));

	let last = vscode.workspace.workspaceFolders?.length || 0;
	// this should never be the first workspace folder
	if (last !== 0) { vscode.workspace.updateWorkspaceFolders(last, 0, { uri: vscode.Uri.parse('fildir:/'), name: "Filtered View" }); }

	vscode.workspace.onDidChangeWorkspaceFolders(filDirProvider.workspacesChanged);

}

export function deactivate(context: vscode.ExtensionContext) {

	let fildirIndex: number | null = null;
	vscode.workspace.workspaceFolders?.forEach((folder, index) => {

		if (folder.uri.scheme === "fildir") {
			fildirIndex = index;
		}
	});

	if (fildirIndex !== null) {

		vscode.workspace.updateWorkspaceFolders(fildirIndex, 1);
	}
}

