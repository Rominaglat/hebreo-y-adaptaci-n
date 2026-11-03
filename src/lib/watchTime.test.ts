import { describe, it, expect } from 'vitest';
import { WatchClock, MAX_SEGMENT_MS } from './watchTime';

function clockAt(start = 0) {
  let t = start;
  const clock = new WatchClock(() => t);
  return { clock, advance: (ms: number) => { t += ms; } };
}

describe('WatchClock', () => {
  it('counts only the time the video is playing', () => {
    const { clock, advance } = clockAt();
    advance(5_000); // paused before playing: not counted
    clock.play();
    advance(10_000);
    clock.pause();
    advance(60_000); // paused: not counted
    clock.play();
    advance(4_000);
    expect(clock.take()).toBe(14);
  });

  it('returns whole seconds and carries the remainder to the next take', () => {
    const { clock, advance } = clockAt();
    clock.play();
    advance(2_600);
    expect(clock.take()).toBe(2);
    advance(1_500);
    expect(clock.take()).toBe(2); // 0.6 carried + 1.5
    expect(clock.take()).toBe(0);
  });

  it('ignores a repeated play or pause', () => {
    const { clock, advance } = clockAt();
    clock.play();
    advance(3_000);
    clock.play(); // must not restart the segment
    advance(3_000);
    clock.pause();
    clock.pause();
    expect(clock.take()).toBe(6);
  });

  it('caps a segment that spans a sleeping device', () => {
    const { clock, advance } = clockAt();
    clock.play();
    advance(2 * 60 * 60 * 1000); // lid closed for two hours mid-play
    expect(clock.take()).toBe(MAX_SEGMENT_MS / 1000);
  });

  it('gives back seconds whose send failed', () => {
    const { clock, advance } = clockAt();
    clock.play();
    advance(8_000);
    const sent = clock.take();
    clock.restore(sent);
    advance(2_000);
    expect(clock.take()).toBe(10);
  });

  it('drops a stalled stretch but keeps counting after it', () => {
    const { clock, advance } = clockAt();
    clock.play();
    advance(10_000);
    expect(clock.take()).toBe(10);
    advance(30_000); // the video froze: position didn't move
    clock.discardSegment();
    expect(clock.playing).toBe(true);
    advance(5_000); // it recovered without telling us
    expect(clock.take()).toBe(5);
  });

  it('keeps already-closed time when a stretch is dropped', () => {
    const { clock, advance } = clockAt();
    clock.play();
    advance(3_000);
    clock.pause(); // 3 s banked, not yet sent
    clock.play();
    advance(30_000);
    clock.discardSegment();
    expect(clock.take()).toBe(3);
  });

  it('reports whether it is playing', () => {
    const { clock } = clockAt();
    expect(clock.playing).toBe(false);
    clock.play();
    expect(clock.playing).toBe(true);
    clock.pause();
    expect(clock.playing).toBe(false);
  });
});
