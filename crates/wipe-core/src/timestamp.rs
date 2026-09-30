//! Timestamps do combat log.
//!
//! Formato atual: `9/28/2026 21:03:11.1234-3` (data, hora local, fração, offset em horas do UTC).
//! Logs antigos não têm ano nem offset: `9/28 21:03:11.123`.

/// Converte para milissegundos desde a epoch Unix, em UTC quando há offset.
/// Sem offset, o valor é o horário local tratado como UTC (serve para tempos relativos).
pub fn parse_timestamp(ts: &str, default_year: i32) -> Option<i64> {
    let (date, time) = ts.trim().split_once(' ')?;

    let mut dp = date.split('/');
    let month: u32 = dp.next()?.parse().ok()?;
    let day: u32 = dp.next()?.parse().ok()?;
    let year: i32 = match dp.next() {
        Some(y) => y.parse().ok()?,
        None => default_year,
    };

    let (clock, tz_hours) = split_tz(time);
    let mut tp = clock.split(':');
    let h: i64 = tp.next()?.parse().ok()?;
    let m: i64 = tp.next()?.parse().ok()?;
    let sec = tp.next()?;
    let (s, frac) = sec.split_once('.').unwrap_or((sec, "0"));
    let s: i64 = s.parse().ok()?;
    let ms = frac_to_ms(frac)?;

    let days = days_from_civil(year, month, day);
    let local_ms = (((days * 24 + h) * 60 + m) * 60 + s) * 1000 + ms;
    Some(local_ms - (tz_hours * 3_600_000.0) as i64)
}

/// Offset em horas a partir do timestamp (0 se ausente).
pub fn tz_offset_hours(ts: &str) -> f64 {
    ts.trim().split_once(' ').map(|(_, t)| split_tz(t).1).unwrap_or(0.0)
}

fn split_tz(time: &str) -> (&str, f64) {
    match time.rfind(['+', '-']) {
        Some(i) => (&time[..i], time[i..].parse().unwrap_or(0.0)),
        None => (time, 0.0),
    }
}

fn frac_to_ms(frac: &str) -> Option<i64> {
    let digits: String = frac.chars().chain("000".chars()).take(3).collect();
    digits.parse().ok()
}

/// Dias desde 1970-01-01 (algoritmo de Howard Hinnant).
fn days_from_civil(y: i32, m: u32, d: u32) -> i64 {
    let y = (if m <= 2 { y - 1 } else { y }) as i64;
    let era = (if y >= 0 { y } else { y - 399 }) / 400;
    let yoe = y - era * 400;
    let m = m as i64;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Epoch (ms, UTC) no formato do log, no fuso dado: `9/29/2026 21:05:53.413-3`.
pub fn format_timestamp(epoch_ms: i64, tz_hours: f64) -> String {
    let local = epoch_ms + (tz_hours * 3_600_000.0) as i64;
    let (days, ms_of_day) = (local.div_euclid(86_400_000), local.rem_euclid(86_400_000));
    let (y, m, d) = civil_from_days(days);
    let (h, min, s, ms) = (ms_of_day / 3_600_000, ms_of_day / 60_000 % 60, ms_of_day / 1000 % 60, ms_of_day % 1000);
    let tz = if tz_hours.fract() == 0.0 { format!("{:+}", tz_hours as i64) } else { format!("{tz_hours:+}") };
    format!("{m}/{d}/{y} {h:02}:{min:02}:{s:02}.{ms:03}{tz}")
}

/// Inverso de `days_from_civil` (Howard Hinnant).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_modern_format() {
        // 2026-09-28 21:03:11.123 no UTC-3 = 2026-09-29 00:03:11.123 UTC
        let t = parse_timestamp("9/28/2026 21:03:11.1234-3", 2000).unwrap();
        assert_eq!(t, 1_790_640_191_123);
        assert_eq!(tz_offset_hours("9/28/2026 21:03:11.1234-3"), -3.0);
        assert_eq!(format_timestamp(t, -3.0), "9/28/2026 21:03:11.123-3");
        assert_eq!(parse_timestamp(&format_timestamp(t, 5.5), 2000), Some(t));
    }

    #[test]
    fn parses_legacy_format() {
        let a = parse_timestamp("9/28 21:03:11.123", 2026).unwrap();
        let b = parse_timestamp("9/28 21:03:12.623", 2026).unwrap();
        assert_eq!(b - a, 1500);
    }
}
