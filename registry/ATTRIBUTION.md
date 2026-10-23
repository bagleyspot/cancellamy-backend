# Attribution and license of the registry data

The whole `registry/` folder is published under **Creative Commons Attribution-ShareAlike 4.0 International** (see `LICENSE`
in this folder); the application code of the repository is AGPL-3.0-only. Upstream notices: `THIRD-PARTY-NOTICES.md`.
Contributions to the registry are accepted under the same CC BY-SA 4.0 license.

Part of `brokers.yaml` is derived from third-party data. Each entry records its sources in `provenance[]`.

## DataBrokersWatch.org (CC BY-SA 4.0)

- Source: **DataBrokersWatch.org** data brokers database (https://databrokerswatch.org), the directory behind the
  YourDigitalRights project, exported as CSV on 2026-10-23.
- License: Creative Commons Attribution-ShareAlike 4.0 International, https://creativecommons.org/licenses/by-sa/4.0/
- What was taken: for 47 organisations located in the EU/EEA, UK or Switzerland, or publishing GDPR/DPO contact signals,
  the name, domain, country, an inferred category, privacy-oriented email addresses (privacy, DPO, GDPR, legal, data
  protection) and the privacy-policy URL. For existing entries, the same privacy-oriented email addresses were added
  when the entry had none, and the source was recorded in `provenance`.
- What was NOT taken: the company-enrichment columns (employees, revenue, social media handles, technology stacks,
  logos and similar), which are not needed and come from third-party enrichment services.
- Changes: selection, normalisation and categorisation by the Cancellamy project. All imported contacts are marked
  `verified: false` and the entries `third_party`: they are leads that a person must confirm on the organisation's
  own site before automatic sending is enabled.
- Share-alike: because those entries are part of the registry, the registry as a whole is distributed under CC BY-SA 4.0,
  which also satisfies the share-alike requirement (the other sources are CC0 or MIT, compatible, or our own research).

Other sources and their licenses are listed in `docs/04-registry.md`.
