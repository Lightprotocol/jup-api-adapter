#!/usr/bin/env bash

# Validate version argument
VERSION_TYPE=$1
if [[ ! $VERSION_TYPE =~ ^(patch|minor|major)$ ]]; then
    echo "Usage: ./publish.sh <patch|minor|major>"
    exit 1
fi

# Build and publish
yarn version --$VERSION_TYPE
yarn clean
yarn build
yarn publish --access public

echo "Published new $VERSION_TYPE version successfully"