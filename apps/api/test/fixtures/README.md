# Test fixtures

Every test replays these files instead of touching the network.

They are **synthetic**: fictional employers on the reserved `.test` domain,
written on 2026-10-08 to mirror the structure of real Brave Search API
responses and real Belgian SME websites. They are deliberately not recorded
from live sites, because this repository is public and recorded pages would
put real people's names into it. Each file names the URL it stands for in its
first line (HTML comment) or in its `_fixture` key (JSON).

To record a real response for local debugging, use a private directory that
is git-ignored; never commit it.
