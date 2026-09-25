// plugins/melgen/src/meter.rs
//
// The bar the pattern is built against. Melody only asks how many steps a
// bar holds; the pulse tables the drum port carries are not consulted here,
// so this is the small half of that meter: sanitised time signature plus
// steps per bar in quarter-note units scaled by the resolution.

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub struct Meter {
    pub num: i32,
    pub den: i32,
}

impl Meter {
    pub const fn new(num: i32, den: i32) -> Self {
        Meter {
            num: if num < 1 { 1 } else if num > 16 { 16 } else { num },
            den: match den {
                1 | 2 | 4 | 8 | 16 => den,
                _ => 4,
            },
        }
    }

    pub fn steps_per_bar(&self, steps_per_beat: i32) -> i32 {
        let steps = (self.num * steps_per_beat * 4 + self.den / 2) / self.den;
        steps.max(1)
    }
}
