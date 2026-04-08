// SPDX-License-Identifier: MIT
// Copyright Rob Marissen.

// Shared renderer utilities for all result windows.

// Append HTML to the #stdout element, keeping only the last 100 lines.
function appendToStdout(html) {
    const el = document.getElementById('stdout');
    if (!el) return;
    const parts = (el.innerHTML + html).split('<br>');
    el.innerHTML = parts.length > 101 ? parts.slice(-101).join('<br>') : parts.join('<br>');
}
