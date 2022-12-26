import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { config } from "process";

const filters = [
	"disco",
	"oms/helm",
];

export class FilteredDirectoryProvider
	implements vscode.TreeDataProvider<DirItem>
{
	private _onDidChangeTreeData: vscode.EventEmitter<any> =
		new vscode.EventEmitter<any>();
	readonly onDidChangeTreeData: vscode.Event<any> =
		this._onDidChangeTreeData.event;

	constructor(private name: string | undefined, private workspaceRoot: string | undefined) {
		this.workspaceRoot = workspaceRoot;
	}

	public refresh(): any {
		console.debug("Refreshing");
		this._onDidChangeTreeData.fire(undefined);
	}

	getTreeItem(element: DirItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: DirItem): Thenable<DirItem[]> {
		if (!this.workspaceRoot) {
			vscode.window.showInformationMessage("No dependency in empty workspace");
			return Promise.resolve([]);
		}

		if (element) {
			return Promise.resolve(
				this.traverseTree(
					element.fullPath
				)
			);
		} else {
			return Promise.resolve(this.traverseTree(this.workspaceRoot));
		}
	}

	traverseTree(searchpath: string): DirItem[] {
		console.debug("Traverse tree " + path);

		let items: DirItem[] = [];

		let dirs: DirItem[] = [];
		fs.readdirSync(searchpath, { withFileTypes: true }).forEach((item) => {
			let fullpath = path.join(searchpath, item.name);
			let trimmedpath = fullpath.slice(this.workspaceRoot!.length + 1);

			// check filters -- maybe this path starts with one of our filters: add it
			//  -- maybe our path is a prefix match for a filter, in which case, add it so we can traverse
			let matchesFilter = false;
			let prefixOfFilter = false;
			filters.forEach(f => {
				if (trimmedpath.startsWith(f)) {
					matchesFilter = true;
				}
				if (f.startsWith(trimmedpath)) {
					prefixOfFilter = true;
				}
			});


			if (item.isDirectory()) {
				if (matchesFilter || prefixOfFilter) { dirs.push(new DirItem(item.name, trimmedpath, fullpath, false)); }
			} else if (item.isFile()) {
				if (matchesFilter) { items.push(new DirItem(item.name, trimmedpath, fullpath, true)); }

			} else {
				console.debug("Skipped: " + item.name);
			}

		});

		items = dirs.concat(items);

		return items;
	}

	private pathExists(p: string): boolean {
		try {
			fs.accessSync(p);
		} catch (err) {
			return false;
		}
		return true;
	}

	public openClickedItem(path: string) {
		console.debug("Open " + path);
		vscode.workspace.openTextDocument(path).then(document => {
			vscode.window.showTextDocument(document, { preview: false });
		});
	}
}


class DirItem extends vscode.TreeItem {
	constructor(
		public readonly name: string,
		public readonly relativePath: string,
		public readonly fullPath: string,
		public readonly isFile: boolean,
	) {
		let collapsibleState = isFile ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed
		super(name, collapsibleState);
		// this.tooltip = `Hello`;
		this.description = relativePath;
		this.relativePath = relativePath;

		if (isFile) {
			this.command = { command: 'open_clicked_item', arguments: [this.fullPath], title: 'Open' };
		}
	}

	iconPath = {
		light: path.join(
			__filename,
			"..",
			"..",
			"resources",
			"light",
			"dependency.svg"
		),
		dark: path.join(
			__filename,
			"..",
			"..",
			"resources",
			"dark",
			"dependency.svg"
		),
	};
}

export function activate(context: vscode.ExtensionContext) {
	const rootPath =
		vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
			? vscode.workspace.workspaceFolders[0].uri.fsPath
			: undefined;
	const filDirProvider = new FilteredDirectoryProvider(vscode.workspace.name, rootPath);
	vscode.window.registerTreeDataProvider('fildir', filDirProvider);
	vscode.commands.registerCommand('fildir.refresh', () =>
		filDirProvider.refresh()
	);
	vscode.commands.registerCommand('open_clicked_item', fullpath => filDirProvider.openClickedItem(fullpath));
}

