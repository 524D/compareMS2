# Development info

This file contains info to aid development of compareMS. It includes some common HTML/CSS/Javascript tips and hints,
partly as a reminder , but hopefully also usefull to others.

## Start the compareMS GUI in debug mode
To enable the Chrome debug tools, set environment variable CPM_MS2_DEBUG

In bash:

```bash
export CPM_MS2_DEBUG="x" && electron-forge start
```

In Windows CMD:

```
SET CPM_MS2_DEBUG=X
electron-forge start
```

To run without debug tools again:

In bash:

```bash
unset CPM_MS2_DEBUG && electron-forge start
```

In Windows CMD:

```
SET CPM_MS2_DEBUG=
electron-forge start
```

## Electron tips

This section contains tips/best practices on using Electron.

## HTML/CSS/Javascipt tips
This section contains tips to avoid common pitfalls in HTML/CSS/Javascript

### Scroll regions

Scrolling can be enabled in CSS by setting the ```overflow``` property. Usually this is done on elements that have a size relative to the
available space. However, this only works if ALL higher level blocks define their size (often just ```height: 100%```), including the
```html``` and ```body``` element!

```css
html, body {
    height: 100%;
    width: 100%;
    margin: 0;
    padding: 0;
 }

.myclass {
    height: calc(100% - 75px);
    overflow: auto;
    /* Or: */
    overflow-y: auto;
    overflow-x: hidden;
}
```

### Box sizing
By default, sizes specified in CSS don't include padding and borders. As this is usually not handy, it is
common to change this globally (https://developer.mozilla.org/en-US/docs/Web/CSS/box-sizing):

```css
* {
    box-sizing: border-box;
}
```

# Absolute position relative to parent
Sometime in CSS, we want to specify the position of elements in "absolute" terms, but usually this should still be relative to the parent element.
The parents style should then contain:

```css
.mycontainer {
   position: relative; /* This causes child elements with "absolute" position to be placed relative to this section, not page */
}
```

