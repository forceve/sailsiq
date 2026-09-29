"""Necessary ceiling conditions, including rejection of always-DENY gates."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from check_wireless_budget import reachable, stage_reachable, thresholds

t = dict(internal_free=60000, dma_free=20000, internal_largest=10000, dma_largest=8000)
assert reachable(t, 81000, 73000, 59000)
assert not reachable(t, 59999, 73000, 59000)
assert not reachable(t, 60000, 73000, 59000)  # zero room for allocator overhead
assert not reachable(t, 81000, 19999, 59000)
assert not reachable(t, 81000, 73000, 9999)
assert not reachable(dict(t, internal_free=136244), 81876, 73744, 59168)
assert not reachable(dict(t, dma_largest=87092), 200000, 200000, 59168)
assert not reachable(t, 81000 - 30000, 73000 - 30000, 59000)
assert reachable(t, 81000, 25000, 11000)  # need not force internal total onto DMA
assert stage_reachable(60000, 81000, 20000)
assert not stage_reachable(60000, 80000, 20000)  # exact boundary has no overhead margin
assert stage_reachable(60000, 100000, 20000, 10000) # RF check after known prior stage
assert not stage_reachable(60000, 90000, 20000, 10000)
print('PASS 13 wireless gate ceiling/capability/startup/coexistence negative and positive cases')
