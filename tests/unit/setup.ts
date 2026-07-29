// jsdom doesn't implement IndexedDB; fake-indexeddb/auto installs a polyfill
// on the global object. Imported once here (setupFiles), not per-test, so any
// module capturing a reference to `indexedDB` at import time sees it too.
import 'fake-indexeddb/auto';
