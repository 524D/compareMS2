# compareMS2

Compare samples by MS2 spectra

## Install

Install nodejs:

* On Linux `apt install nodejs`
* On windows download from: <https://nodejs.org/en/download/>

From the command promp:

```text
npm install -g electron-forge
git clone https://github.com/524D/compareMS2
cd compareMS2
npm install
```

## Run in development mode

```text
electron-forge start
```

## Building

To build a distributable package (for the platform where this command is executed from):

```text
electron-forge make
```

The resulting installer can than be found (relative to the compareMS2 main directory) in:
`out\make\squirrel.windows\x64\compareMS2-x.y.z Setup.exe` for windows.
