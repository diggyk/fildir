import * as vscode from "vscode";
import { Uri } from "vscode";
import * as fs from "fs";
import * as path from "path";
import { create } from "domain";
import { join } from "path";
import { type } from "os";

/// Provides both the filesystem implementation, so we can add filtered view in the file explorer,
/// and a tree view so we can set up an editable view of globss
export class FilteredDirectoryProvider
  implements vscode.FileSystemProvider, vscode.TreeDataProvider<string>
{
  private filters: Set<string> = new Set();
  private rootWatchers: Map<string, vscode.FileSystemWatcher> = new Map();

  constructor() {
    this.reloadConfig();
    this.rebuildRootNodes();
  }

  /// Reload our configs from the settings
  public reloadConfig() {
    let filters: string[] = vscode.workspace
      .getConfiguration("")
      .get("fildir.prefixes")!;
    let normalizedFilters: Set<string> = new Set();
    // validate all filters end with "/"
    filters.forEach((f) => {
      f.endsWith("/")
        ? normalizedFilters.add(f)
        : normalizedFilters.add(f + "/");
    });

    this.filters = normalizedFilters;
    this._onDidChangeTreeData.fire(null);
    this._onDidChangeFile.fire([
      {
        type: vscode.FileChangeType.Changed,
        uri: Uri.parse("fildir:/"),
      },
    ]);
  }

  /// Add a new prefix, usually from the context menu in the file explorer
  public addPrefix(uri: Uri) {
    // we only support the file scheme
    if (uri.scheme !== "file") {
      vscode.window.showErrorMessage("Fildir only supports local files");
      return;
    }

    // we only support directory prefixes
    vscode.workspace.fs.stat(uri).then((stat) => {
      if (stat.type !== vscode.FileType.Directory) {
        vscode.window.showErrorMessage(
          "Fildir prefixes are limited to directories, not files"
        );

        return;
      }
    });

    let relPath = vscode.workspace.asRelativePath(uri);
    relPath = relPath.split("/").slice(1).join("/") + "/";
    this.filters.add(relPath);

    let config = vscode.workspace.getConfiguration();
    config.update(
      "fildir.prefixes",
      [...this.filters],
      vscode.ConfigurationTarget.Workspace
    );

    this._onDidChangeTreeData.fire(null);

    // fire an update to prompt updating the tree
    let events = [];
    let split = relPath.split('/');
    for (let x = 0; x < split.length; x++) {
      events.push ({
        type: vscode.FileChangeType.Created,
        uri: Uri.parse("fildir:/" + split.slice(0,x)),
      });

    }
    this._onDidChangeFile.fire(events);
  }

  public removePrefix(prefix: string) {
    this.filters.delete(prefix);
    let config = vscode.workspace.getConfiguration();
    config.update(
      "fildir.prefixes",
      [...this.filters],
      vscode.ConfigurationTarget.Workspace
    );

    this._onDidChangeTreeData.fire(null);

    let events = [];
    for (const workspace of vscode.workspace.workspaceFolders || []) {
      events.push(
        {
          type: vscode.FileChangeType.Deleted,
          uri: Uri.parse("fildir:/" + workspace.name + "/" + prefix)
        }
      );
    }
    this._onDidChangeFile.fire(events);
  }

  private _onDidChangeTreeData = new vscode.EventEmitter<string | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /// Get an item to display in the Fildir panel
  getTreeItem(element: string): vscode.TreeItem | Thenable<vscode.TreeItem> {
    let item = new vscode.TreeItem(element);
    item.iconPath = {
      light: path.join(
        __filename,
        "..",
        "..",
        "resources",
        "light",
        "list-filter.svg"
      ),
      dark: path.join(
        __filename,
        "..",
        "..",
        "resources",
        "dark",
        "list-filter.svg"
      ),
    };

    item.contextValue = "fildir_prefix";

    return item;
  }

  /// Get all the elements in the fildir panel
  getChildren(element?: string | undefined): vscode.ProviderResult<string[]> {
    let list = [...this.filters].sort();
    return list;
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
      if (workspaceRoot.uri.scheme !== "file") {
        continue;
      }

      this.rootNodes.set(workspaceRoot.name, workspaceRoot.uri.path);
      let watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspaceRoot.uri, "**") );
      this.rootWatchers.set(workspaceRoot.name, watcher);
      watcher.onDidCreate(uri => {
        let r = vscode.workspace.asRelativePath(uri);
        this._onDidChangeFile.fire([{uri: Uri.parse("fildir:/" + r), type: vscode.FileChangeType.Created}]);
      });
      watcher.onDidDelete(uri => {
        let r= vscode.workspace.asRelativePath(uri);
        this._onDidChangeFile.fire([{uri: Uri.parse("fildir:/" + r), type: vscode.FileChangeType.Deleted}]);
      });
    }

    // if we have 0 roots, we should remove ourselves as well
    if (this.rootNodes.size === 0) {
      vscode.workspace.updateWorkspaceFolders(
        0,
        vscode.workspace.workspaceFolders.length
      );
    }

    this._onDidChangeFile.fire([
      {
        type: vscode.FileChangeType.Changed,
        uri: Uri.parse("fildir:/"),
      },
    ]);
  }

  /// splits a relative path into workspace name and relative path to that workspace root
  splitRelativePath(path: string): [string, string] {
    if (path[0] === "/") {
      path = path.substring(1);
    }

    let segments = path.split("/");
    if (!this.rootNodes.has(segments[0])) {
      throw vscode.FileSystemError.FileNotFound(
        "Unknown root note: " + path
      );
    }

    let subpath = segments.slice(1).join("/");

    return [segments[0], subpath];
  }

  /// takes a path that's given and converts it to a file system path based on workspace root
  /// and also gives us the "subpath" which is the relative path to the file where we should find it
  /// if it exists under a workspace root folder
  convertPath(path: string): string[] {
    let [rootbase, subpath] = this.splitRelativePath(path);

    return [this.rootNodes.get(rootbase) + "/" + subpath, subpath];
  }

  /// See if our path is a prefix to one of our filters
  prefixOfFilter(subpath: string): boolean {
    let prefixOfFilter = false;
    for (const filter of this.filters) {
      if (filter.startsWith(subpath + "/")) {
        prefixOfFilter = true;
      }
    }
    return prefixOfFilter;
  }

  /// check is a subpath is prefixed by one of our filters
  subpathMatchesFilter(subpath: string): boolean {
    if (!subpath.endsWith("/")) {
      subpath = subpath + "/";
    }

    let matchesFilter = false;
    for (const filter of this.filters) {
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
    newOrder.push({ uri: vscode.Uri.parse("fildir:/"), name: "Filtered View" });
    vscode.workspace.updateWorkspaceFolders(0, folders.length, ...newOrder);
  }

  /// We use this to tell VSCode to reexamine our root
  private _onDidChangeFile = new vscode.EventEmitter<
    vscode.FileChangeEvent[]
  >();
  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> =
    this._onDidChangeFile.event;

  watch(
    uri: vscode.Uri,
    options: {
      readonly recursive: boolean;
      readonly excludes: readonly string[];
    }
  ): vscode.Disposable {
    return new vscode.Disposable(() => {});
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

  readDirectory(
    uri: vscode.Uri
  ): [string, vscode.FileType][] | Thenable<[string, vscode.FileType][]> {
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

    // read from the read file system...
    return vscode.workspace.fs.readDirectory(Uri.file(path)).then((finds) => {
      let items: [string, vscode.FileType][] = [];

      // examine all directory entries and their types to see what we need to include in our filtered view
      for (const [dirent, direntType] of finds) {
        if (matchesFilter) {
          // because our directory matched a filter, we can display all items
          items.push([dirent, direntType]);
        } else {
          // our directory itself didn't match a filter, but one of the subdirs might be
          // a prefix of one of our filters, meaning it is part of the path to get to our
          // desired filtered directory
          let testpath =
            subpath.trim().length > 0 ? subpath + "/" + dirent : dirent;

          if (
            direntType === vscode.FileType.Directory &&
            this.prefixOfFilter(testpath)
          ) {
            items.push([dirent, direntType]);
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

  writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { readonly create: boolean; readonly overwrite: boolean }
  ): void | Thenable<void> {
    let [path, subpath] = this.convertPath(uri.path);
    return vscode.workspace.fs.writeFile(Uri.file(path), content);
  }

  delete(
    uri: vscode.Uri,
    options: { readonly recursive: boolean }
  ): void | Thenable<void> {
    let [path, subpath] = this.convertPath(uri.path);
    return vscode.workspace.fs.delete(Uri.file(path), options);
  }

  rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    options: { readonly overwrite: boolean }
  ): void | Thenable<void> {
    let [oldpath, oldsubpath] = this.convertPath(oldUri.path);
    let [newpath, newsubpath] = this.convertPath(newUri.path);
    return vscode.workspace.fs.rename(
      Uri.file(oldpath),
      Uri.file(newpath),
      options
    );
  }

  copy(
    source: vscode.Uri,
    destination: vscode.Uri,
    options: { readonly overwrite: boolean }
  ): void | Thenable<void> {
    throw new Error("Method not implemented.");
  }
}

export function activate(context: vscode.ExtensionContext) {
  const filDirProvider = new FilteredDirectoryProvider();

  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider("fildir", filDirProvider, {
      isCaseSensitive: true,
    })
  );
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("fildir", filDirProvider)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("fildir.reload_config", () =>
      filDirProvider.reloadConfig()
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("fildir.add_prefix", (uri) =>
      filDirProvider.addPrefix(uri)
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("fildir.remove_prefix", (prefix) =>
      filDirProvider.removePrefix(prefix)
    )
  );

  let last = vscode.workspace.workspaceFolders?.length || 0;
  // this should never be the first workspace folder
  if (last !== 0) {
    vscode.workspace.updateWorkspaceFolders(last, 0, {
      uri: vscode.Uri.parse("fildir:/"),
      name: "Filtered View",
    });
  }

  vscode.workspace.onDidChangeWorkspaceFolders(
    filDirProvider.workspacesChanged
  );
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
