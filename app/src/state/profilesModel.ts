import type { Profile } from "../ipc/bindings/Profile";
import type { ProfileList } from "../ipc/bindings/ProfileList";
import type { ConfirmCopy } from "./confirmCopy";

export const DEFAULT_PROFILE_ID = "default";

export const GIT_CONFIG_AUTHOR = "Uses the name and email in your Git config";

export const authorLine = (profile: Profile): string => (profile.author_name === "" && profile.author_email === "" ? GIT_CONFIG_AUTHOR : `${profile.author_name} <${profile.author_email}>`);

export function deleteReason(profile: Profile, list: ProfileList): string | undefined {
  if (profile.id === list.active) return "The active profile cannot be deleted; switch to another profile first";
  if (profile.id === DEFAULT_PROFILE_ID) return "The Default profile cannot be deleted";
  if (list.profiles.length <= 1) return "The last profile cannot be deleted";
  return undefined;
}

export function deleteProfileCopy(profile: Profile): ConfirmCopy {
  return {
    title: `Delete profile ${profile.name}`,
    names: [`${profile.name} · ${authorLine(profile)}`],
    consequences: ["Its saved open tabs are forgotten.", "No repository, commit, or Git config changes."],
    confirmLabel: "Delete profile",
  };
}
