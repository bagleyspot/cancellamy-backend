# Changelog

## [0.2.0](https://github.com/bagleyspot/cancellamy-backend/compare/v0.1.0...v0.2.0) (2026-10-31)


### Features

* **queue:** integrate BullMQ and Redis for staggered email dispatching and quota guard ([#1](https://github.com/bagleyspot/cancellamy-backend/issues/1)) ([b9f12dd](https://github.com/bagleyspot/cancellamy-backend/commit/b9f12ddeb1a4e1bc04d38b6932590b0a26661c02))
* **registry:** auto-verify contact channels and clean up broker schema ([#11](https://github.com/bagleyspot/cancellamy-backend/issues/11)) ([02cbc26](https://github.com/bagleyspot/cancellamy-backend/commit/02cbc265d2131872048de624082c74175628430d))
* **registry:** match brokers with the profile's country ([#7](https://github.com/bagleyspot/cancellamy-backend/issues/7)) ([d45e937](https://github.com/bagleyspot/cancellamy-backend/commit/d45e93712edf18e9f8cd9628b5d65a655118cba9))
* **registry:** verify Italian entries on their official sites ([#6](https://github.com/bagleyspot/cancellamy-backend/issues/6)) ([1f7119d](https://github.com/bagleyspot/cancellamy-backend/commit/1f7119d121a74c2e421b3e358c7f47530aec43c0))
* **sender:** connect the user's Gmail with Google OAuth ([#5](https://github.com/bagleyspot/cancellamy-backend/issues/5)) ([58b5a20](https://github.com/bagleyspot/cancellamy-backend/commit/58b5a201974f82f9f64e336eec83bcabe85c8ced))


### Bug fixes

* **deps:** force multer 2.5.0 under @nestjs/platform-express ([#4](https://github.com/bagleyspot/cancellamy-backend/issues/4)) ([0742025](https://github.com/bagleyspot/cancellamy-backend/commit/07420251f488acf0f1e93b8f0095eabc18afb07f))
* **inbound:** decode HTML entities in the right order ([#9](https://github.com/bagleyspot/cancellamy-backend/issues/9)) ([940b97e](https://github.com/bagleyspot/cancellamy-backend/commit/940b97e9518c8d63db91a3148c429ead36842c2e))
* **security:** validate profile ids, guard the verifier crawler, bump js-yaml ([#9](https://github.com/bagleyspot/cancellamy-backend/issues/9)) ([118bcf7](https://github.com/bagleyspot/cancellamy-backend/commit/118bcf7e76151b678f1cbb3fbd162df14751ef99))


### Documentation

* add project overview explaining why Cancellamy exists ([#3](https://github.com/bagleyspot/cancellamy-backend/issues/3)) ([4e2d9e5](https://github.com/bagleyspot/cancellamy-backend/commit/4e2d9e51ef577abb3b738f8a0082101f3ccab42a))
* describe repository protections and release process ([#8](https://github.com/bagleyspot/cancellamy-backend/issues/8)) ([9c6ee31](https://github.com/bagleyspot/cancellamy-backend/commit/9c6ee31f50e3476e9bb8697a5575683165ef3c51))

## Changelog

All notable changes are listed here. This file is maintained by [release-please](https://github.com/googleapis/release-please)
from Conventional Commit pull request titles.
