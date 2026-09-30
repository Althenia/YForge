use crate::model::GraphEdge;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RowLayout {
    pub column: usize,
    pub edges: Vec<GraphEdge>,
}

pub(crate) fn index_u32(value: usize) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

pub(crate) fn layout(parents: &[Vec<usize>]) -> Vec<RowLayout> {
    let row_count = parents.len();
    let mut lanes: Vec<Option<usize>> = Vec::new();
    let mut columns = Vec::with_capacity(row_count);
    let mut routed: Vec<Vec<(usize, usize)>> = Vec::with_capacity(row_count);

    for (row, row_parents) in parents.iter().enumerate() {
        let waiting: Vec<usize> = lanes
            .iter()
            .enumerate()
            .filter(|(_, reserved)| **reserved == Some(row))
            .map(|(column, _)| column)
            .collect();
        let column = match waiting.first() {
            Some(&column) => column,
            None => lanes
                .iter()
                .position(Option::is_none)
                .unwrap_or(lanes.len()),
        };
        if column == lanes.len() {
            lanes.push(None);
        }
        lanes[column] = None;

        let mut edges = Vec::with_capacity(row_parents.len());
        for (position, &parent) in row_parents.iter().enumerate() {
            if position == 0 {
                lanes[column] = Some(parent);
                edges.push((parent, column));
                continue;
            }
            if let Some(reserved) = lanes.iter().position(|lane| *lane == Some(parent)) {
                edges.push((parent, reserved));
                continue;
            }
            let free = match lanes
                .iter()
                .enumerate()
                .position(|(lane, reserved)| reserved.is_none() && !waiting.contains(&lane))
            {
                Some(free) => free,
                None => {
                    lanes.push(None);
                    lanes.len() - 1
                }
            };
            lanes[free] = Some(parent);
            edges.push((parent, free));
        }
        for &other in waiting.iter().skip(1) {
            if lanes[other] == Some(row) {
                lanes[other] = None;
            }
        }
        columns.push(column);
        routed.push(edges);
    }

    columns
        .iter()
        .zip(routed)
        .map(|(&column, edges)| RowLayout {
            column,
            edges: edges
                .into_iter()
                .map(|(parent, lane)| GraphEdge {
                    lane: index_u32(lane),
                    parent_row: (parent < row_count).then(|| index_u32(parent)),
                    parent_column: columns.get(parent).map(|&column| index_u32(column)),
                })
                .collect(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn columns(layout: &[RowLayout]) -> Vec<usize> {
        layout.iter().map(|row| row.column).collect()
    }

    fn edge(lane: u32, parent_row: u32, parent_column: u32) -> GraphEdge {
        GraphEdge {
            lane,
            parent_row: Some(parent_row),
            parent_column: Some(parent_column),
        }
    }

    #[test]
    fn linear_history_stays_in_column_zero() {
        let result = layout(&[vec![1], vec![2], vec![]]);
        assert_eq!(columns(&result), vec![0, 0, 0]);
        assert_eq!(result[0].edges, vec![edge(0, 1, 0)]);
        assert_eq!(result[1].edges, vec![edge(0, 2, 0)]);
        assert!(result[2].edges.is_empty());
    }

    #[test]
    fn merge_keeps_first_parent_column_and_gives_second_parent_the_leftmost_free_column() {
        let result = layout(&[vec![1, 2], vec![3], vec![3], vec![]]);
        assert_eq!(columns(&result), vec![0, 0, 1, 0]);
        assert_eq!(result[0].edges, vec![edge(0, 1, 0), edge(1, 2, 1)]);
    }

    #[test]
    fn branch_ends_on_its_parents_row_when_two_columns_reserve_one_commit() {
        let result = layout(&[vec![2], vec![2], vec![]]);
        assert_eq!(columns(&result), vec![0, 1, 0]);
        assert_eq!(result[1].edges, vec![edge(1, 2, 0)]);

        let after = layout(&[vec![2], vec![2], vec![3], vec![]]);
        assert_eq!(columns(&after), vec![0, 1, 0, 0]);
    }

    #[test]
    fn freed_leftmost_column_is_reused_by_a_later_tip() {
        let result = layout(&[vec![4], vec![2], vec![], vec![], vec![]]);
        assert_eq!(columns(&result), vec![0, 1, 1, 1, 0]);
    }

    #[test]
    fn further_parent_reuses_a_column_already_reserved_for_it() {
        let result = layout(&[vec![1, 3], vec![2, 3], vec![3], vec![]]);
        assert_eq!(columns(&result), vec![0, 0, 0, 0]);
        assert_eq!(result[0].edges, vec![edge(0, 1, 0), edge(1, 3, 0)]);
        assert_eq!(result[1].edges, vec![edge(0, 2, 0), edge(1, 3, 0)]);
    }

    #[test]
    fn parent_outside_the_rows_has_no_row_or_column_and_keeps_its_lane() {
        let result = layout(&[vec![5], vec![]]);
        assert_eq!(columns(&result), vec![0, 1]);
        assert_eq!(
            result[0].edges,
            vec![GraphEdge {
                lane: 0,
                parent_row: None,
                parent_column: None
            }]
        );
    }
}
