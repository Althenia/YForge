const SCHEMES = ["https://", "http://", "ssh://", "git://", "file://"];

export function cloneUrlProblem(url: string): string | undefined {
  const text = url.trim();
  if (text === "") return "Enter a repository address";
  const scheme = SCHEMES.some((prefix) => text.startsWith(prefix) && text.length > prefix.length);
  const scp = /^[^/\s:]+:(?!\/\/)[^\s]+$/.test(text) && !/^[A-Za-z]:[\\/]/.test(text);
  return scheme || scp || text.startsWith("/") ? undefined : "Use an https or ssh address, or an absolute local path";
}

export function cloneRepoName(url: string): string {
  const cleaned = url.trim().replace(/[\\/]+$/, "").replace(/\.git$/, "");
  const tail = cleaned.split(/[\\/:]/).pop() ?? "";
  return tail === "" ? "repository" : tail;
}

const joinPath = (parent: string, name: string): string => `${parent.replace(/\/+$/, "")}/${name}`;

export const cloneDestination = (parent: string, url: string): string => joinPath(parent, cloneRepoName(url));

export const createDestination = (parent: string, name: string): string => joinPath(parent, name.trim());

export function createNameProblem(name: string): string | undefined {
  const text = name.trim();
  if (text === "") return "Enter a name";
  return /[\\/]/.test(text) || text === "." || text === ".." ? "The name cannot contain slashes" : undefined;
}
