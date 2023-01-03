# Fildir

Filtered Directories (Fildir) helps you focus on just the parts of your monorepo that you care about. Fildir creates a virtual workspace root in the File Explorer, listing only the directories (and their subdirectories and files, recursively) that match one of a set of prefixes you specify.  Adding a new prefix is simple: right click on a directory in the File Explorer and select "Add as Filter Prefix". Removing a prefix is also easy, accessible from either the Fildir panel, Settings UI, or in the `settings.json` file.

![Demo1](demo1.gif)
![Demo2](demo2.gif)

## Limitations

* At present, Fildir only works with traditional filesystems and does not work with workspaces that are mounted over devices such as FTP or NFS.
* Fildir is only examining directories when looking for prefix matches and does not support substring matches on directories names
* Because Fildir is a implemented via a custom filesystem provider, SCM integrations will not work. That is to say, you may not see annotations for files that have changed, or other UX features provided by various SCM extensions.


