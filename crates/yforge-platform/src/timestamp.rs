const MILLIS_PER_SECOND: i64 = 1000;
const SECONDS_PER_DAY: i64 = 86_400;

pub(crate) fn rfc3339_from_millis(millis: i64) -> String {
    let seconds = millis.div_euclid(MILLIS_PER_SECOND);
    let days = seconds.div_euclid(SECONDS_PER_DAY);
    let of_day = seconds.rem_euclid(SECONDS_PER_DAY);
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        of_day / 3600,
        of_day % 3600 / 60,
        of_day % 60
    )
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::rfc3339_from_millis;

    #[test]
    fn epoch_milliseconds_format_as_utc_rfc3339_dropping_sub_second_precision() {
        for (millis, expected) in [
            (0, "1970-01-01T00:00:00Z"),
            (999, "1970-01-01T00:00:00Z"),
            (951_782_400_000, "2000-02-29T00:00:00Z"),
            (1_788_256_800_000, "2026-09-01T10:00:00Z"),
            (1_788_343_259_999, "2026-09-02T10:00:59Z"),
            (-1_000, "1969-12-31T23:59:59Z"),
        ] {
            assert_eq!(rfc3339_from_millis(millis), expected, "{millis}");
        }
    }
}
