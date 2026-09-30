# Third-party provider marks

Official marks of AI providers, stored byte-identical to the published files and never recoloured, cropped, filtered, or redrawn. They are rendered only by `app/src/components/ProviderLogo.tsx`, scaled proportionally, one mark per card, never combined with another mark or with the YForge mark. Each mark identifies its provider on the provider card and provider list; YForge does not claim endorsement or partnership. Attribution is shown in Settings → AI.

| File | Mark | Variant | Source | Accessed | sha256 |
|---|---|---|---|---|---|
| `openai/OAI_OpenAI-Blossom_Black.svg` | OpenAI Blossom | black, for light backgrounds | `OpenAI-logos/SVGs/OAI_OpenAI-Blossom_Black.svg` in https://cdn.openai.com/brand/openai-logos.zip (the "Download logos" link of https://openai.com/brand/; archive `Last-Modified` 2026-07-06, archive sha256 `c54e85ab5884228f89f0230dd8effa8d588cad78166fe954135f4afa553222db`) | 2026-09-30 | `75c1e9fffa5e8c437bec1d67197a73992bca45d166c6ff23215185dea8fae92a` |
| `openai/OAI_OpenAI-Blossom_White.svg` | OpenAI Blossom | white, for dark backgrounds | `OpenAI-logos/SVGs/OAI_OpenAI-Blossom_White.svg` in the same archive | 2026-09-30 | `01d158767c4eec0e47bd617e67759c33da0accd1438be1a8d29dfdb99ce87285` |
| `openrouter/glyph-ink.svg` | OpenRouter glyph | Ink, for light backgrounds | https://openrouter.ai/brand/logos/transparent/glyph/svg/glyph-ink.svg (listed on https://openrouter.ai/brand) | 2026-09-30 | `91be6b8a91745f089bfe42b89a5cbcd4b666fca6473610f9a6c11a31bd7523bc` |
| `openrouter/glyph-cloud.svg` | OpenRouter glyph | Cloud, for dark backgrounds | https://openrouter.ai/brand/logos/transparent/glyph/svg/glyph-cloud.svg (listed on https://openrouter.ai/brand) | 2026-09-30 | `385bbf00cd5718ad652fdfc05b4b4e7d0ea3a834cfd807e1133d3bee2b9a7c81` |

## Terms

- **OpenAI** (https://openai.com/brand/, read 2026-09-30, "Design Guidelines" and "Usage terms"): the guidelines address partners, developers, and other third parties and grant a non-exclusive, non-transferable permission to use the Marks on these conditions, which this use follows:
  - use the logo only when it directly relates to OpenAI services (here: the ChatGPT subscription provider that runs through OpenAI's Codex CLI);
  - use the logo exactly as provided, without added colors, effects, or elements, and acknowledge that it belongs to OpenAI;
  - do not present it more prominently than the product's own marks, do not imply endorsement or sponsorship, and do not use the Blossom as primary branding;
  - OpenAI may review the use, require changes, or terminate the permission, after which use must stop promptly.
  Permission requests and questions go to partnercomms@openai.com. The wordmark is not used.
- **OpenRouter** (https://openrouter.ai/brand, read 2026-09-30): the page publishes "every configuration of the OpenRouter mark, ready to use" and asks only "don't stretch, recolor, or remix the marks". Ink is listed for light backgrounds and Cloud for dark ones. The page and the Terms of Service (https://openrouter.ai/terms, last updated 2026-08-31, read 2026-09-30) state no other logo terms and no explicit license grant; use rests on the brand page's invitation to use the assets unmodified. This is the least explicit of the three sources.
- **Anthropic / Claude Code**: no mark is stored. Anthropic's Trademark Guidelines (https://www.anthropic.com/legal/trademark-guidelines, effective 2024-08-01) permit trademarks "only as specifically permitted by us and only in materials we approve beforehand", and the Claude Code legal page (https://code.claude.com/docs/en/legal-and-compliance) allows only plain-text statements that a product runs Claude Code and requires written permission for any other use of the names or logos. No written permission exists, so the Claude Code card uses the neutral terminal glyph and the name "Claude Code" in plain text. Replace the glyph only after Anthropic grants permission and record it here.
- **OpenAI-compatible** endpoints have no vendor; the card uses the neutral plug glyph.

## Notes

- `openai.com` answers automated clients with a challenge page for some requests; the logo archive is served from `cdn.openai.com` and was fetched directly. The four SVGs were checked by sha256 after copying.
