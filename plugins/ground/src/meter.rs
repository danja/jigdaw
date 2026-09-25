// plugins/ground/src/meter.rs
//
// The bar the form is built against. Ground counts steps per bar as time
// signature beats times steps per beat, which is downspout's meterStepsPerBar
// verbatim: a 6/8 bar holds more steps than a 4/4 one rather than the same
// number stretched. Nothing here knows about pulses or groupings, because
// the bass port never consults them.

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub struct Meter {
    pub num: i32,
    pub den: i32,
}

impl Meter {
    pub const fn new(num: i32, den: i32) -> Self {
        Meter {
            num: if num < 1 { 1 } else if num > 32 { 32 } else { num },
            den: match den {
                1 | 2 | 4 | 8 | 16 | 32 => den,
                _ => 4,
            },
        }
    }

    pub fn steps_per_bar(&self, steps_per_beat: i32) -> i32 {
        self.num * steps_per_beat.max(1)
    }
}
