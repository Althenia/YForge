use yforge_core::RepoRef;

const GIT_SUFFIX: &str = ".git";
const SCM_SEGMENT: &str = "scm";
const PROJECTS_SEGMENT: &str = "projects";
const REPOS_SEGMENT: &str = "repos";

fn without_port(authority: &str) -> &str {
    match authority.rsplit_once(':') {
        Some((host, port))
            if !port.is_empty() && port.bytes().all(|byte| byte.is_ascii_digit()) =>
        {
            host
        }
        _ => authority,
    }
}

fn strip_git(name: &str) -> &str {
    name.strip_suffix(GIT_SUFFIX).unwrap_or(name)
}

fn split_repo(path: &str) -> Option<RepoRef> {
    let mut segments: Vec<&str> = path
        .split(['?', '#'])
        .next()?
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect();
    if let [SCM_SEGMENT, ..] = segments[..] {
        segments.remove(0);
    } else if let [PROJECTS_SEGMENT, project, REPOS_SEGMENT, repo, ..] = segments[..] {
        return repo_ref(project, repo);
    }
    let last = segments.pop()?;
    if segments.is_empty() {
        return None;
    }
    repo_ref(&segments.join("/"), last)
}

fn repo_ref(owner: &str, repo: &str) -> Option<RepoRef> {
    let repo = strip_git(repo);
    if owner.is_empty() || repo.is_empty() {
        return None;
    }
    Some(RepoRef {
        owner: owner.to_owned(),
        repo: repo.to_owned(),
    })
}

fn split_url(url: &str) -> Option<(String, &str)> {
    if let Some((scheme, rest)) = url.split_once("://") {
        let scheme = scheme.to_ascii_lowercase();
        if !matches!(scheme.as_str(), "https" | "http" | "ssh" | "git") {
            return None;
        }
        let (authority, path) = rest.split_once('/')?;
        let host = authority
            .rsplit_once('@')
            .map_or(authority, |(_, host)| host);
        let host = if matches!(scheme.as_str(), "ssh" | "git") {
            without_port(host)
        } else {
            host
        };
        return Some((host.to_owned(), path));
    }
    let (authority, path) = url.split_once(':')?;
    let (user, host) = authority.split_once('@')?;
    if user.is_empty() || host.contains('/') {
        return None;
    }
    Some((host.to_owned(), path))
}

pub fn parse_remote(url: &str) -> Option<(String, RepoRef)> {
    let (host, path) = split_url(url.trim())?;
    let host = host.to_ascii_lowercase();
    if host.is_empty() {
        return None;
    }
    Some((host, split_repo(path)?))
}
