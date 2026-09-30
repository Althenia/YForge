import { Show } from "solid-js";
import blossomBlack from "../../../brand/third-party/openai/OAI_OpenAI-Blossom_Black.svg";
import blossomWhite from "../../../brand/third-party/openai/OAI_OpenAI-Blossom_White.svg";
import glyphCloud from "../../../brand/third-party/openrouter/glyph-cloud.svg";
import glyphInk from "../../../brand/third-party/openrouter/glyph-ink.svg";
import type { LogoKey } from "../state/aiModel";
import { Icon } from "./Icon";

const marks = {
  openai: { onDark: blossomWhite, onLight: blossomBlack, name: "OpenAI" },
  openrouter: { onDark: glyphCloud, onLight: glyphInk, name: "OpenRouter" },
} as const;

export function ProviderLogo(props: { logo: LogoKey; size?: 24 | 32 }) {
  const size = () => props.size ?? 24;
  const mark = () => (props.logo === "openai" || props.logo === "openrouter" ? marks[props.logo] : undefined);
  return (
    <span class="provider-logo" classList={{ neutral: mark() === undefined }} style={{ "--logo-size": `${size()}px` }} aria-hidden="true">
      <Show when={mark()} fallback={<Icon name={props.logo === "neutral-cli" ? "terminal" : "plug"} />}>
        {(source) => (
          <>
            <img class="on-dark" src={source().onDark} alt="" width={size()} height={size()} draggable={false} />
            <img class="on-light" src={source().onLight} alt="" width={size()} height={size()} draggable={false} />
          </>
        )}
      </Show>
    </span>
  );
}
