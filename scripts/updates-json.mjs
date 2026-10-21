// Writes the update manifest Firefox polls, from the extension manifest.
//
// An installed copy reads its update_url from itself, so that URL and the
// add-on id can never be corrected later: a tester on a wrong one is stranded
// with no way to migrate. The version and the asset name are equally
// unforgiving -- a mismatch here means the poll finds nothing and nobody ever
// updates, silently. So none of it is written by hand.
import { readFileSync, writeFileSync } from 'fs';

const root = new URL('..', import.meta.url);
const m = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
const { id, update_url: updateUrl } = m.browser_specific_settings.gecko;
const asset = `zhihu_paper-${m.version}.xpi`;

const updates = {
  addons: {
    [id]: {
      updates: [{
        version: m.version,
        update_link: `https://github.com/sx349/zhihu_paper/releases/download/v${m.version}/${asset}`
      }]
    }
  }
};

const out = new URL('docs/updates.json', root);
writeFileSync(out, JSON.stringify(updates, null, 2) + '\n');
console.log(`docs/updates.json -> ${m.version}, ${asset}`);
console.log(`served at ${updateUrl}`);
