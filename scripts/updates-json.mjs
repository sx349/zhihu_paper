// Writes the update manifest Firefox polls, for one released version.
//
// An installed copy reads its update_url from itself, so that URL and the
// add-on id can never be corrected later: a tester on a wrong one is stranded
// with no way to migrate. The asset name is equally unforgiving -- a mismatch
// here means the poll finds nothing and nobody ever updates, silently. So
// none of it is written by hand.
//
// The version is an argument rather than manifest.json's, because the two
// legitimately differ: store review can take a month, and for that month the
// manifest describes what is being reviewed while this file must keep
// describing what people can actually download. Run it when the release
// exists, not when the package is built.
//
//   node scripts/updates-json.mjs 0.5.1
import { readFileSync, writeFileSync } from 'fs';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('usage: node scripts/updates-json.mjs <version>   e.g. 0.5.1');
  console.error('the version of the GitHub release whose asset this should point at');
  process.exit(1);
}

const root = new URL('..', import.meta.url);
const m = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
const { id, update_url: updateUrl } = m.browser_specific_settings.gecko;

// No version in the name: the tag carries it, as it does for zhihu_paper.zip.
// A versioned name would make the install page name a file that does not exist
// yet for as long as review takes.
const ASSET = 'zhihu_paper.xpi';

const updates = {
  addons: {
    [id]: {
      updates: [{
        version,
        update_link: `https://github.com/sx349/zhihu_paper/releases/download/v${version}/${ASSET}`
      }]
    }
  }
};

writeFileSync(new URL('docs/updates.json', root), JSON.stringify(updates, null, 2) + '\n');
console.log(`docs/updates.json -> ${version}, ${ASSET}`);
if (version !== m.version) console.log(`note: manifest is ${m.version}; this points at the released ${version}`);
console.log(`served at ${updateUrl}`);
