# ADR 001: Repository and package architecture

Status: Accepted

## Decision

Use one npm package with boundary-oriented `src` directories: domain, CLI, renderer, providers, templates, assets, and media. Extract packages only when independent release or dependency needs appear.

## Consequences

Imports and tests make boundaries concrete without workspace overhead. The CLI is an adapter; external providers never belong to rendering.
