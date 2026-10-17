// Render the VoiceMatch panel to HTML in both locales (no browser needed).
// Usage: node experiments/issue-5-voice-match-ui.mjs
import { createElement } from '../examples/universal-app/node_modules/react/index.js';
import { renderToStaticMarkup } from '../examples/universal-app/node_modules/react-dom/server.node.js';
import { VoiceMatch } from '../examples/universal-app/src/components/VoiceMatch.js';
import { strings } from '../examples/universal-app/src/i18n.js';

for (const locale of ['en', 'ru']) {
  console.log(
    renderToStaticMarkup(
      createElement(VoiceMatch, {
        text: 'Hello',
        lang: 'auto',
        t: strings(locale),
        onHead: () => {},
      })
    )
  );
}
