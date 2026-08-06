// Every rule in the kit model, exercised against the real names recorded in
// ~/Sites/obra-shadcn-ui-kit/figma/CLAUDE.md. Run: node tests/kit-model.test.js
// The kit model is read back out of the SHIPPED code.js between its sentinels,
// so the tested code and the running code cannot drift. Figma loads a single
// file with no build step, which is why the model lives inline there.
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '..', 'code.js'), 'utf8');
const start = source.indexOf('// ==== KIT MODEL START ====');
const end = source.indexOf('// ==== KIT MODEL END ====');
if (start === -1 || end === -1) {
  console.error('Kit model sentinels not found in code.js');
  process.exit(1);
}
const K = {};
new Function('exports', source.slice(start, end) + `
  exports.kitIdentifyFile = kitIdentifyFile;
  exports.kitClassifySource = kitClassifySource;
  exports.kitStyleSuffixOf = kitStyleSuffixOf;
  exports.kitLucideScheme = kitLucideScheme;
  exports.kitRewriteCandidates = kitRewriteCandidates;
  exports.kitUnfixableReason = kitUnfixableReason;
  exports.kitIsDividerPage = kitIsDividerPage;
  exports.kitIsTokenPage = kitIsTokenPage;
  exports.kitComponentFromPageName = kitComponentFromPageName;
  exports.kitIsProOnly = kitIsProOnly;
  exports.kitIsInternalHelper = kitIsInternalHelper;
  exports.kitExpectedDocFrame = kitExpectedDocFrame;
  exports.kitExpectsFooter = kitExpectsFooter;
`)(K);

let fails = 0;
function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { fails++; console.log('FAIL  ' + label + '\n        got  ' + g + '\n        want ' + w); }
  else console.log('ok    ' + label + '  ' + g);
}
function ok(label, cond, detail) {
  if (!cond) { fails++; console.log('FAIL  ' + label + (detail ? '\n        ' + detail : '')); }
  else console.log('ok    ' + label + (detail ? '   (' + detail + ')' : ''));
}

console.log('\n── File identity ──');
eq('Pro file', K.kitIdentifyFile('Obra shadcn/ui kit - Pro edition (1.14.0) - Nova'),
   { style: 'Nova', edition: 'Pro', version: '1.14.0', isKitFile: true });
eq('Community file, trailing warning does not hide the style',
   K.kitIdentifyFile('Obra shadcn/ui kit - Community edition (2.0.0) - Nova (WIP. Dont republish until done)'),
   { style: 'Nova', edition: 'Community', version: '2.0.0', isKitFile: true });
eq('Luma', K.kitIdentifyFile('Obra shadcn/ui kit - Pro edition (1.14.0) - Luma').style, 'Luma');
eq('a non-kit file is recognised as such',
   K.kitIdentifyFile('Some client project').isKitFile, false);

console.log('\n── Style suffix ──');
eq('reads the style off a component name', K.kitStyleSuffixOf('Button - Nova'), 'Nova');
eq('handles an ampersand name', K.kitStyleSuffixOf('Select & Combobox - Luma'), 'Luma');
eq('a non-style suffix is not a style', K.kitStyleSuffixOf('Button - Large'), null);
eq('no suffix at all', K.kitStyleSuffixOf('Separator'), null);

console.log('\n── Rule 1: style-suffix rewriting ──');
// The case the generic matcher cannot see: similarity ≈ 0.69, below any safe threshold.
eq('Nova reference inside Luma maps to the Luma component',
   K.kitRewriteCandidates('Button - Nova', 'Luma').map(c => c.name), ['Button - Luma']);
eq('ampersand names survive the rewrite',
   K.kitRewriteCandidates('Select & Combobox - Nova', 'Vega').map(c => c.name), ['Select & Combobox - Vega']);
eq('a reference already in this style needs no rewrite',
   K.kitRewriteCandidates('Button - Nova', 'Nova'), []);
eq('unsuffixed components are left alone',
   K.kitRewriteCandidates('Separator', 'Luma'), []);

console.log('\n── Rule 2: Lucide naming ──');
eq('single space is the published scheme', K.kitLucideScheme('Lucide / square-dashed'), 'published');
eq('double space is the full unpublished set', K.kitLucideScheme('Lucide  / activity'), 'unpublished');
eq('an ordinary icon is neither', K.kitLucideScheme('Icon / square-dashed'), null);
eq('published icons rewrite to the local Icon namespace',
   K.kitRewriteCandidates('Lucide / square-dashed', 'Nova').map(c => c.name), ['Icon / square-dashed']);
eq('the unpublished set has no rewrite — there is no target',
   K.kitRewriteCandidates('Lucide  / activity', 'Nova'), []);

console.log('\n── Rule 3: structurally unfixable ──');
const lucideGap = K.kitUnfixableReason('Lucide  / activity');
ok('the missing icon set is named as such', lucideGap && lucideGap.code === 'lucide-set-missing');
ok('and the message explains why Swap Library fails',
   lucideGap && /Swap Library/.test(lucideGap.message));
eq('a published icon is not unfixable', K.kitUnfixableReason('Lucide / square-dashed'), null);
eq('an ordinary component is not unfixable', K.kitUnfixableReason('Button - Nova'), null);

console.log('\n── Library classification ──');
eq('own library', K.kitClassifySource('x', 'Obra shadcn/ui kit - Pro edition (1.14.0) - Nova', 'Nova').kind, 'self');
eq('sibling style is drift',
   K.kitClassifySource('x', 'Obra shadcn/ui kit - Pro edition (1.14.0) - Vega', 'Luma').kind, 'sibling-style');
eq('Daphne is contamination, not drift',
   K.kitClassifySource('x', 'Obra shadcn/ui kit - Pro edition (1.14.0) - Nova (Daphne)', 'Nova').kind, 'daphne');
eq('a client fork is recognised',
   K.kitClassifySource('x', 'AI Digital Elevate UI Library - Nova', 'Nova').kind, 'client-fork');
eq('with no library name, the component name carries it',
   K.kitClassifySource('Button - Vega', null, 'Luma').kind, 'sibling-style');
eq('and names this file’s own',
   K.kitClassifySource('Button - Luma', null, 'Luma').kind, 'self');
eq('the unpublished Lucide set is classified structurally',
   K.kitClassifySource('Lucide  / activity', null, 'Nova').kind, 'lucide-full-set');

console.log('\n── Page vocabulary ──');
ok('dashes are a divider', K.kitIsDividerPage('---'));
ok('emoji sections are dividers', K.kitIsDividerPage('📖 Changelog'));
ok('a component page is not', !K.kitIsDividerPage('Accordion'));
ok('token pages are known', K.kitIsTokenPage('Colors') && K.kitIsTokenPage('Icons'));

const styleified = K.kitComponentFromPageName('Button & Icon Button •');
eq('the bullet marks style-ification, not the name',
   [styleified.name, styleified.styleified], ['Button & Icon Button', true]);
const oc = K.kitComponentFromPageName('Backdrop (OC)');
eq('(OC) marks Obra Custom and is kept in the name',
   [oc.name, oc.baseName, oc.obraCustom], ['Backdrop (OC)', 'Backdrop', true]);
eq('sorting ignores the marker', K.kitComponentFromPageName('Command •').sortKey, 'command');
eq('token pages document no component', K.kitComponentFromPageName('Typography'), null);
eq('the template is not a component', K.kitComponentFromPageName('(Template)'), null);
eq('internal components is not a component page', K.kitComponentFromPageName('Internal Components'), null);
eq('Pro Blocks pages are not components', K.kitComponentFromPageName('Pro blocks - Applications'), null);

console.log('\n── Community coverage ──');
ok('chat primitives are Pro-only', K.kitIsProOnly('Message Scroller') && K.kitIsProOnly('Bubble'));
ok('THE trap: Todo Marker is not the chat Marker', !K.kitIsProOnly('Todo Marker (OC)'),
   'anchored at the start of the name');
ok('an ordinary component is not Pro-only', !K.kitIsProOnly('Accordion'));
ok('a suffixed chat primitive still counts', K.kitIsProOnly('Message - Nova'));

console.log('\n── Internal helpers ──');
ok('dot-prefixed helpers are internal',
   K.kitIsInternalHelper('.Component Page Footer') && K.kitIsInternalHelper('.Slot Default Placeholder'));
ok('a normal component is not', !K.kitIsInternalHelper('Button - Nova'));

console.log('\n── Doc frame expectations ──');
eq('doc frame carries the style', K.kitExpectedDocFrame('Alert', 'Nova'), 'Alert - Nova');
ok('component pages expect a footer', K.kitExpectsFooter('Accordion'));
ok('token pages must NOT have one',
   !K.kitExpectsFooter('Colors') && !K.kitExpectsFooter('Typography') &&
   !K.kitExpectsFooter('Icons') && !K.kitExpectsFooter('Shadows'));
ok('dividers expect nothing', !K.kitExpectsFooter('---'));

console.log(fails ? '\n' + fails + ' FAILURE(S)' : '\nall kit-model assertions pass');
process.exit(fails ? 1 : 0);
