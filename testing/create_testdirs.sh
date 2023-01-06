#!/bin/bash

for name in $( cat foldernames.lst ); do 
    mkdir -p $name/node_modules/alpha
    mkdir -p $name/node_modules/bravo
    mkdir -p $name/node_modules/zulu

    mkdir $name/src
    touch $name/src/main.rs

    mkdir $name/resources
    touch $name/resources/logo.png
    touch $name/resources/main.css
    touch $name/resources/gamma.dat

    touch $name/.gitignore
    touch $name/Cargo.toml
    touch $name/package.json
done
