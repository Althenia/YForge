use std::future::Future;

use crate::error::Result;

pub(crate) const LIST_CAP: usize = 1000;

pub(crate) struct Listing<T> {
    pub items: Vec<T>,
    pub total: Option<u32>,
    pub capped: bool,
}

pub(crate) struct Chunk<T, C> {
    pub items: Vec<T>,
    pub total: Option<u32>,
    pub next: Option<C>,
}

pub(crate) async fn collect<T, C, F, Fut>(first: C, mut fetch: F) -> Result<Listing<T>>
where
    F: FnMut(C) -> Fut,
    Fut: Future<Output = Result<Chunk<T, C>>>,
{
    let mut items: Vec<T> = Vec::new();
    let mut total = None;
    let mut cursor = Some(first);
    while let Some(at) = cursor.take() {
        let chunk = fetch(at).await?;
        total = chunk.total.or(total);
        let empty = chunk.items.is_empty();
        items.extend(chunk.items);
        cursor = chunk.next.filter(|_| !empty);
        if items.len() >= LIST_CAP {
            break;
        }
    }
    let more = if items.len() > LIST_CAP {
        true
    } else if items.len() == LIST_CAP {
        match (total, cursor) {
            (Some(total), _) => total as usize > LIST_CAP,
            (None, Some(at)) => !fetch(at).await?.items.is_empty(),
            (None, None) => false,
        }
    } else {
        false
    };
    items.truncate(LIST_CAP);
    let total = if more {
        total
    } else {
        Some(u32::try_from(items.len()).unwrap_or(u32::MAX))
    };
    Ok(Listing {
        items,
        total,
        capped: more,
    })
}
