#!/usr/bin/env bash
GITHUB_USERNAME="524D"
GITHUB_REPO="compareMS2"

# This shell script is used to build the Electron application
# for distribution.
# It clones the latest version of the repository from GitHub
# into a temporary directory, modifies the version number in package.json
# to include a timestamp, and then uses electron-forge to create
# distributable packages for the current platform.
# It appends the timestamp to the version number in package.json,
# by replacing 'build.unknown' with the current date and time in 'YYYYMMDDHHMMSS' format.

# Save the original directory
ORIG_DIR=$(pwd)

# Get the latest version from GitHub, and put it in a separate directory
# Create temp dir with unique name
TIMESTAMP=$(date +%Y%m%d%H%M%S)
TEMP_DIR="$(pwd)/temp/build_dir_$TIMESTAMP"

echo "Cloning repository to temporary directory: $TEMP_DIR"
# Remove temp dir if it exists, then create it
rm -rf "${TEMP_DIR}"
mkdir -p "${TEMP_DIR}"
cd "${TEMP_DIR}" || exit 1
git clone "https://github.com/${GITHUB_USERNAME}/${GITHUB_REPO}.git" .

# Get a list of Git branches, and ask the user to select one
# Uncomment the following lines if you want to select a branch
echo "Available branches:"
git branch -r | grep -v '\->' | sed 's/  origin\///' | nl
read -r -p "Enter the number of the branch you want to build (default is 1): " branch_number
branch_number=${branch_number:-1}
selected_branch=$(git branch -r | grep -v '\->' | sed 's/  origin\///' | sed -n "${branch_number}p")
echo "Checking out branch: $selected_branch"
git checkout "$selected_branch" || exit 1

sed -i.bak "s/build-unknown/build-$TIMESTAMP/" package.json
rm package.json.bak

# Install dependencies
yarn

# Create the distributable packages
# If running on linux, use the script 'build-linux.sh' instead
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    ./build-linux.sh
else
    yarn make
fi

echo "Build completed. Output is in the directory: $TEMP_DIR/out/make"

# Move the output to the original directory
cd $ORIG_DIR || exit 1

if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    #For Linux, the installer is in a subdirectory named deb/x64
    INSTALLER_DIR="out/make/deb/x64"
    INSTALLER_NAME=$(ls --indicator-style=none "${TEMP_DIR}/${INSTALLER_DIR}/" | grep .deb)
elif [[ "$OSTYPE" == "msys"* ]]; then
    #For Windows, the installer is in a subdirectory named squirrel.windows/x64
    INSTALLER_DIR="out/make/squirrel.windows/x64"
    INSTALLER_NAME=$(ls --indicator-style=none "${TEMP_DIR}/${INSTALLER_DIR}/" | grep .exe)
elif [[ "$OSTYPE" == "darwin"* ]]; then
    #For MacOS, the installer is in a subdirectory named zip
    INSTALLER_DIR="zip"
    INSTALLER_NAME=$(ls --indicator-style=none "${TEMP_DIR}/${INSTALLER_DIR}/" | grep .zip)
else
    echo "Unsupported OS: $OSTYPE"
    exit 1
fi

# Put the installer in to the releases directory
mkdir -p releases
mv "${TEMP_DIR}/${INSTALLER_DIR}/${INSTALLER_NAME}" "releases/${INSTALLER_NAME}"
echo "Installer is located at directory releases/${INSTALLER_NAME}"

# Ask if the user wants to delete the temporary build directory
read -r -p "Do you want to delete the temporary build directory $TEMP_DIR? (y/n) " response
if [[ "$response" == "y" || "$response" == "Y" ]]; then
    rm -rf "${TEMP_DIR}"
    echo "Temporary build directory deleted."
else
    echo "Temporary build directory retained at $TEMP_DIR."
fi