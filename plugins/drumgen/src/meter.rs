// plugins/drumgen/src/meter.rs
//
// The bar the pattern is built against. Downspout's shared meter model knows
// pulses and groupings per time signature; this port keeps the part drumgen
// consults: how many steps a bar holds, whether the feel is compound or
// triple, and where the pulses start. Steps are counted in quarter-note
// units scaled by the resolution, so 6/8 at sixteenth resolution is 12 steps.

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

    /// 6/8, 9/8, 12/8: beats in threes, which gets dedicated anchor and fill
    /// behaviour rather than the straight-meter tables.
    pub fn compound(&self) -> bool {
        self.den == 8 && self.num % 3 == 0
    }

    pub fn triple(&self) -> bool {
        self.num == 3 && !self.compound()
    }

    pub fn pulses(&self) -> i32 {
        if self.compound() { self.num / 3 } else { self.num }
    }

    /// Which pulse a beat belongs to. In a simple meter every beat is its own
    /// pulse; in a compound one each group of three is.
    pub fn pulse_index(&self, beat: i32) -> i32 {
        if self.compound() { beat / 3 } else { beat }
    }

    pub fn pulse_start(&self, beat: i32) -> bool {
        if self.compound() { beat % 3 == 0 } else { true }
    }

    pub fn steps_per_bar(&self, steps_per_beat: i32) -> i32 {
        let steps = (self.num * steps_per_beat * 4 + self.den / 2) / self.den;
        steps.max(1)
    }

    /// How many quarter-note beats the fill zone covers. A compound bar fills
    /// its last pulse group; anywhere else a strong fill takes two beats.
    pub fn fill_beats(&self, fill: f32) -> i32 {
        if self.compound() {
            (self.num * 4 + self.den / 2) / self.den / self.pulses().max(1)
        } else if fill > 0.62 {
            2
        } else {
            1
        }
        .max(1)
    }
}
