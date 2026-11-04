// Load the browser wallet bundle as an ES module and guarantee that every
// global dependency exists before app.js attaches handlers or boots.
import "/ui-helpers.js";
import "/friday-browser.js";
import "/app.js";
