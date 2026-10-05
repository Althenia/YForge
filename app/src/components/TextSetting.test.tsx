import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TextSetting } from "./TextSetting";
import { flush, type } from "./testkit";

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; });

describe("text setting", () => {
  it("keeps a typed command through a pending save and a refusal, then clears the draft after success", async () => {
    const [value, setValue] = createSignal("old");
    const [disabled, setDisabled] = createSignal(false);
    const committed = vi.fn(() => setDisabled(true));
    const host = document.createElement("div");
    document.body.append(host);
    dispose = render(() => <TextSetting label="Command" value={value()} disabled={disabled()} onCommit={committed} />, host);
    const field = host.querySelector<HTMLInputElement>('input[aria-label="Command"]')!;
    type(field, "new command");
    field.dispatchEvent(new FocusEvent("blur"));
    await flush();
    expect(field.disabled).toBe(true);
    expect(field.value).toBe("new command");
    setDisabled(false);
    await flush();
    expect(field.value).toBe("new command");
    field.dispatchEvent(new FocusEvent("blur"));
    expect(committed).toHaveBeenCalledTimes(2);
    setValue("new command");
    setDisabled(false);
    await flush();
    expect(field.value).toBe("new command");
    expect(field.disabled).toBe(false);
  });
});
