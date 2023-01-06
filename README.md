# Fildir

[![vscode version][vs-image]][vs-url]
![][install-url]
![][rate-url]
![][license-url]

Filtered Directories (Fildir) helps you focus on just the parts of your monorepo that you care about. Fildir creates a virtual workspace root in the File Explorer, listing only the directories (and their subdirectories and files, recursively) that match one of a set of prefixes you specify.  Adding a new prefix is simple: right click on a directory or file in the File Explorer and select "Add as Filter Prefix". Removing a prefix is also easy, accessible from either the Fildir panel, Settings UI, or in the `settings.json` file.

![Demo1](demo1.gif)

![Demo2](demo2.gif)

## Usage

When viewing directories in the File Explorer, right click and select `Add as Filter Prefix`. At the bottom of the list of workspace folders, you'll see the `Filtered View` where each root folder is listed along with contents that match the provided filters. Use the `Fildir` panel in the sidebar to remove unwanted filters.

## Changelog

### 0.3.0
* Add support for both files and directories

### 0.2.1
* Initial public release

## Limitations

* At present, Fildir only works with traditional filesystems and does not work with workspaces that are mounted over devices such as FTP or NFS.
* Because Fildir is a implemented via a custom filesystem provider, SCM integrations will not work. That is to say, you may not see annotations for files that have changed, or other UX features provided by various SCM extensions.


[vs-url]: https://marketplace.visualstudio.com/items?itemName=diggyk.fildir
[vs-image]: https://img.shields.io/visual-studio-marketplace/v/diggyk.fildir
[install-url]: https://img.shields.io/visual-studio-marketplace/i/diggyk.fildir
[rate-url]: https://img.shields.io/visual-studio-marketplace/r/diggyk.fildir
[license-url]: https://img.shields.io/github/license/diggyk/fildir