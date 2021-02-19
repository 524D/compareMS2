# compareMS2gui
Compare samples by MS2 spectra

## Install

Install nodejs:

On Linux <code>apt install nodejs</code>

On windows https://nodejs.org/en/download/

From the command promp (in Windows, start "node.js command prompt"):
```bash
npm install -g electron-forge
git clone https://github.com/524D/compareMS2gui
cd compareMS2gui
npm install
```

## Run in development mode

```bash
electron-forge start</code>
```

## Building

To build a distributable package (for the platform where this command is executed from):
```bash
electron-forge make
```

