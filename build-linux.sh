#/bin/bash
mv package.json package.json.keep
cp package.json.keep package.json
perl -pi -e 's/"name": "compare-ms2"/"name": "comparems2"/g; s/"productName": "compareMS2"/"productName": "comparems2"/g; ' package.json
electron-forge make

# Find the line with version number, replace "-" by "~", and rename the .deb file
perl -n -e 'if (m/"version": "([^"]*)"/g) { $v=$1 ; rename("./out/make/comparems2_${v}_amd64.deb", "./out/make/compareMS2-${v}_amd64.deb")}' package.json

mv package.json.keep package.json