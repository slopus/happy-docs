---
layout: ../../layouts/Docs.astro
title: Formal verification
lead: Every security and isolation invariant has a Lean 4 model and a proof, a Rust enforcement point, and a test. This page lists all three and says what is trusted instead of proven.
---

The `proofs/` directory is a Lean 4 project (Lean v4.34.0, no Mathlib, builds
in seconds). Each model mirrors a specific Rust function or SQL policy and
names it in its doc comment. A change to the enforcement, the model, and the
[invariant map](#invariant-map) lands in the same commit.

## What a proof looks like

The row-level security policy every tenant table carries:

```sql
CREATE POLICY tenant_isolation ON <table> TO happy_enterprise_tenant
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
```

is modelled as a predicate on rows, with `SELECT` filtering by it and by an
arbitrary statement predicate `p`. Because `p` is arbitrary, the theorems
cover queries that forget their `WHERE tenant_id = ...`:

```lean
/-- Every row a tenant-scoped query returns belongs to the session's tenant,
whatever the query's own filter is. -/
theorem select_only_tenant {t : τ} {tbl : Table τ α} {p : Row τ α → Bool} {r : Row τ α}
    (h : r ∈ select (some t) tbl p) : r.tenant = t := by
  simp only [select, List.mem_filter, Bool.and_eq_true] at h
  exact policy_some.mp h.2.1

/-- A query that forgets its `WHERE tenant_id = ...` clause returns exactly
the session tenant's rows. -/
theorem select_forgotten_where (t : τ) (tbl : Table τ α) :
    select (some t) tbl (fun _ => true) = ownedBy t tbl := by
  simp [select, ownedBy, policy]
```

Writes get a non-interference theorem: any transaction under tenant `t`
leaves every other tenant's rows exactly as they were.

```lean
theorem applyAll_preserves_other_tenants {t u : τ} (hu : u ≠ t) :
    ∀ {tbl tbl' : Table τ α} {ops : List (Op τ α)},
      applyAll (some t) tbl ops = some tbl' → ownedBy u tbl' = ownedBy u tbl
```

Models are generic over the tenant type (`τ` with `DecidableEq`), so no
theorem depends on how ids are represented. They follow the code's actual
decision procedure: the credential verifier, for example, is modelled with
its lookup of the key by the *unverified* `tid` claim, followed by the check
that the signed `tid` matches the key's owner.

## The models

| File | Models |
|---|---|
| [`Rls.lean`](https://github.com/slopus/happy-commons/blob/main/proofs/HappyEnterprise/Rls.lean) | the `tenant_isolation` policy: sessions, `SELECT`, `INSERT`/`UPDATE`/`DELETE` with `USING` and `WITH CHECK`, transactions |
| [`Auth.lean`](https://github.com/slopus/happy-commons/blob/main/proofs/HappyEnterprise/Auth.lean) | the tenant credential verifier (session tokens, external JWTs, agent API tokens; REST and MCP) and the management verifier; audience disjointness |
| [`Request.lean`](https://github.com/slopus/happy-commons/blob/main/proofs/HappyEnterprise/Request.lean) | an authenticated request through `TenantTx`; transaction-local tenant scope on pooled connections |
| [`Org.lean`](https://github.com/slopus/happy-commons/blob/main/proofs/HappyEnterprise/Org.lean) | teams, owners, permissions and OAuth scopes; the team-invariant triggers as a state machine |
| [`Join.lean`](https://github.com/slopus/happy-commons/blob/main/proofs/HappyEnterprise/Join.lean) | who may log in, email-code checks, verified domains, invite acceptance |
| [`Mfa.lean`](https://github.com/slopus/happy-commons/blob/main/proofs/HappyEnterprise/Mfa.lean) | the 2FA gate (full and partial sessions), enrollment and verification rules |
| [`Mcp.lean`](https://github.com/slopus/happy-commons/blob/main/proofs/HappyEnterprise/Mcp.lean) | MCP request acceptance and tool checks; OAuth code exchange, refresh rotation, revocation |
| [`McpOntology.lean`](https://github.com/slopus/happy-commons/blob/main/proofs/HappyEnterprise/McpOntology.lean) | the MCP ontology tools under the grant's `ontology:*` scopes |
| [`RateLimit.lean`](https://github.com/slopus/happy-commons/blob/main/proofs/HappyEnterprise/RateLimit.lean) | the sliding-window limiter for one key |
| [`Ontology.lean`](https://github.com/slopus/happy-commons/blob/main/proofs/HappyEnterprise/Ontology.lean) | object types, objects, link types and links as a state machine; custom validators as an oracle; per-type access |
| [`Props.lean`](https://github.com/slopus/happy-commons/blob/main/proofs/HappyEnterprise/Props.lean) | property ids: renames, instant removal, re-adding a name, values stored by id, the purge job |
| [`Live.lean`](https://github.com/slopus/happy-commons/blob/main/proofs/HappyEnterprise/Live.lean) | the event outbox (per-organisation sequence numbers, pruning) and live delivery |
| [`Audit.lean`](https://github.com/slopus/happy-commons/blob/main/proofs/Audit.lean) | build-time check that every declaration uses only Lean's standard axioms |

## Keeping the proofs honest

`proofs/check.sh` is part of `scripts/check.sh`, which runs before every commit:

* It greps the sources for `sorry`, `admit`, `axiom`, `native_decide`,
  `implemented_by`, `extern`, `unsafe`, `opaque`, and for disabled linters,
  and fails on any match.
* `lakefile.toml` sets `warningAsError = true`, so an unfinished proof
  (`declaration uses 'sorry'`) fails the build.
* `Audit.lean` is a default build target. It walks every declaration in the
  `HappyEnterprise` namespace and fails unless each depends only on
  `propext`, `Classical.choice`, and `Quot.sound`. That excludes `sorryAx`,
  `Lean.ofReduceBool` (`native_decide`), and any axiom of our own.

```sh
cd proofs && ./check.sh
# ... axiom audit: N HappyEnterprise declarations use only standard axioms
```

## Invariant map

For each invariant: the Lean theorems that prove it about the model, the
Rust code that enforces it, and the tests that check the implementation
against a real Postgres.

### Tenant isolation

| Invariant | Evidence |
|---|---|
| A tenant-scoped read returns only that tenant's rows, whatever the `WHERE` clause | **Lean** `Rls.select_only_tenant`, `Rls.select_forgotten_where`<br>**Rust** RLS `tenant_isolation` `USING`; `TenantTx`/`OrgTx`<br>**Tests** `isolation::every_tenant_table_is_isolated_on_read`, `select_without_where_clause_sees_only_own_rows`, `objects_are_invisible_across_tenants`, `organisation_resources_are_invisible_across_tenants` |
| A write under tenant `t` leaves every other tenant's rows unchanged | **Lean** `Rls.apply_preserves_other_tenants`, `Rls.applyAll_preserves_other_tenants`, `Rls.applyAll_foreign_rows_preexist`<br>**Rust** RLS `USING` + `WITH CHECK`<br>**Tests** `isolation::writes_cannot_produce_rows_of_another_tenant`, `update_and_delete_without_where_clause_touch_only_own_rows`, `api_writes_leave_other_tenants_unchanged` |
| No tenant context means no rows and no writes | **Lean** `Rls.select_no_session`, `Rls.apply_no_session`<br>**Rust** `app_current_tenant_id()` is `NULL` when unset<br>**Tests** `isolation::missing_tenant_context_fails_closed` |
| The tenant context doesn't outlive its transaction | **Lean** `Request.ambientSession_none`, `Request.bare_query_sees_nothing`<br>**Rust** `set_config(..., true)` in `tenant/tx.rs`<br>**Tests** `isolation::tenant_context_does_not_outlive_its_transaction` |
| An authenticated request reads and writes only its own tenant's rows | **Lean** `Request.handleRead_isolated`, `Request.handleWrite_isolated`<br>**Rust** the `TenantTx` extractor<br>**Tests** `isolation::objects_are_invisible_across_tenants`, `organisation_resources_are_invisible_across_tenants` |
| Every table has forced RLS; tenant tables have the exact policy on a `cuid` `tenant_id`; no `SECURITY DEFINER` functions or views; the management role has no grants on tenant data; the tenant role cannot change ids, kinds, or emails | **Lean** schema-level, checked by a catalog test instead<br>**Rust** migrations<br>**Tests** `isolation::catalog_every_table_has_forced_rls`, `role_privileges_are_minimal` |

### Credentials

| Invariant | Evidence |
|---|---|
| An accepted credential yields a context whose tenant owns the verifying key, session key and session, or API token | **Lean** `Auth.verifyTenant_sound`, `Auth.verifyTenant_key_owner`<br>**Rust** `tenant/auth.rs`: tenant-scoped lookups, `tid` = owner check, per-tenant session keys<br>**Tests** `auth::tenant_key_cannot_mint_tokens_for_another_tenant`, `session_token_cannot_be_moved_to_another_org`, `agent_api_tokens`, `tenant_token_claim_validation` |
| The context's user is an active user of the context's organisation | **Lean** `Auth.verifyTenant_user_active`<br>**Rust** user checks in `tenant/auth.rs`<br>**Tests** `auth::external_jwt_authenticates_as_a_member`, `logout_and_deactivation_end_sessions` |
| Revoked or unregistered keys, and ended sessions, are rejected | **Lean** `Auth.verifyTenant_requires_key`, `Auth.verifyTenant_requires_session`<br>**Rust** `revoked_at IS NULL` in the lookups<br>**Tests** `auth::revoked_tenant_key_stops_working`, `logout_and_deactivation_end_sessions`, `mfa::repeated_failures_end_the_session` |
| No token is accepted by two of: tenant REST, MCP, management | **Lean** `Auth.audiences_distinct`, `Auth.audiences_disjoint`, `Auth.rest_mcp_disjoint`<br>**Rust** distinct `aud` constants, `aud: String` in claims, endpoint-specific session kinds<br>**Tests** `auth::tenant_token_is_rejected_by_management_api`, `management_token_is_rejected_by_tenant_api`, `token_with_both_audiences_is_rejected_everywhere`, `session_token_cannot_be_moved_to_another_org` |

### Organisations and permissions

| Invariant | Evidence |
|---|---|
| Every user is in `everyone`; an organisation with an active owner keeps one; system teams are never deleted or renamed | **Lean** `Org.orgStep_preserves_everyone`, `Org.orgStep_preserves_owner`, `Org.orgStep_preserves_system_teams`, `Org.orgRun_preserves`<br>**Rust** triggers in `migrations/20261024000002_organisation.sql`; checks in `tenant/teams.rs`, `tenant/members.rs`<br>**Tests** `org::owners_team_rules`, `database_enforces_team_invariants` |
| Owners hold every permission; a permission granted to `everyone` reaches every user | **Lean** `Org.owners_hold_every_permission`, `Org.everyone_grants`<br>**Rust** `org::user_holds`<br>**Tests** `org::owners_team_rules`, `inviting_needs_the_invite_permission` |
| Actions need their permission; no credential is permitted more than its user holds; scoped (OAuth) credentials never change security posture or the organisation, nor act as owners | **Lean** `Org.permitted_le_holds`, `Org.permitted_unscoped`, `Org.permitted_scoped`, `Org.scoped_never_administers`, `Org.scoped_never_owner`<br>**Rust** `TenantTx::permitted`/`require`/`require_owner`, `scope_allows`<br>**Tests** `org::inviting_needs_the_invite_permission`, `seeing_other_members_needs_the_view_permission`, `verified_domains_let_addresses_join`, `avatars_and_organisation_photo`, `org` unit tests |

### Joining

| Invariant | Evidence |
|---|---|
| Without an invite, only active users, the bootstrap owner of an unowned organisation, and addresses at exactly a verified domain log in; deactivated users never do | **Lean** `Join.loginPath_existing`, `loginPath_bootstrap`, `loginPath_domain`, `loginPath_deactivated`, `loginPath_ineligible`<br>**Rust** `login::login_path`<br>**Tests** `org::bootstrap_owner_claims_the_organisation`, `verified_domains_let_addresses_join`, `owners_team_rules`, `auth::logout_and_deactivation_end_sessions` |
| A domain admits addresses only once verified, and is verified only if the resolver returned that domain's own token at its TXT name | **Lean** `Join.domainStep_verified`, `domainStep_add_unverified`, `domainRun_verified`, `loginPath_domain`<br>**Rust** `teams::verify_domain`, `teams::txt_proves`, `domain_allowed` in `tenant/login.rs`; column grants on `org_domains`<br>**Tests** `org::verified_domains_let_addresses_join`, `isolation::role_privileges_are_minimal` |
| A login code proves an address of this organisation only, and stops working after five attempts | **Lean** `Join.checkChallenge_sound`, `checkChallenge_attempts`<br>**Rust** `login::check_email_challenge`<br>**Tests** `org::login_codes_are_single_use_limited_and_expire` |
| An invite is accepted only in its organisation, with its secret, once, before it expires; the member gets the invited address | **Lean** `Join.acceptInvite_sound`, `acceptInvite_single_use`, `acceptInvite_org_bound`<br>**Rust** `login::accept_invite`<br>**Tests** `org::invites_bind_one_address_to_one_organisation_once` |

### Two-factor authentication

| Invariant | Evidence |
|---|---|
| When 2FA is required, a session without a completed second factor reaches only the partial routes | **Lean** `Mfa.partial_session_gate`, `verifyTenant_partial_requires_2fa`, `verifyTenant_full_session`<br>**Rust** `session_is_full`; the `TenantTx` and `PartialTx` extractors<br>**Tests** `mfa::requiring_2fa_forces_enrollment_then_verification`, `partial_sessions_reach_only_the_second_factor_endpoints` |
| When 2FA is required, a human's context is full only through a session that completed a second factor or an IdP-attested (`amr` = `mfa`) external JWT; agents are exempt by kind | **Lean** `Mfa.verifyTenant_full_human`, `verifyTenant_agent_full`, `verifyTenant_partial_requires_2fa`<br>**Rust** `auth::sessionless_is_full`, `active_user` in `tenant/auth.rs`<br>**Tests** `mfa::sessionless_credentials_respect_the_requirement` |
| A partial session of a user with a factor becomes full only by proving possession of an existing factor; the last factor is kept while 2FA is required; failures end the session | **Lean** `Mfa.partial_session_needs_existing_factor`, `required_factor_kept`, `failures_end_session`<br>**Rust** `mfa::may_enroll`, `mfa::delete_factor`, `mfa::record_failure`<br>**Tests** `mfa::requiring_2fa_forces_enrollment_then_verification`, `security_keys_satisfy_the_requirement`, `repeated_failures_end_the_session` |

### MCP and OAuth

| Invariant | Evidence |
|---|---|
| An MCP request acts for an active user of the organisation in its path, through a full OAuth session of that organisation; a credential works at one organisation's MCP endpoint only | **Lean** `Mcp.mcp_context_in_org`, `Mcp.mcpAccept_one_org`, `Auth.verifyTenant_mcp_scoped`, `Auth.verifyTenant_rest_unscoped`<br>**Rust** `mcp::mcp_tx`, `Endpoint::Mcp` in `tenant/auth.rs`<br>**Tests** `mcp::tokens_are_bound_to_client_verifier_and_org`, `authorization_code_flow_and_tools`, `discovery_documents` |
| MCP tools never exceed the user's permissions or the grant's scopes, and never administer; ontology tools reach a type only with its view (and, to write, edit) access under the grant's ontology scopes, and never change the schema | **Lean** `Mcp.mcp_tool_within_grant`, `Mcp.whoami_within_grant`, `Mcp.mcp_never_administers`, `McpOntology.ontology_tool_within_grant`, `McpOntology.mcp_never_manages_ontology`<br>**Rust** `TenantTx::permitted`, `has_scope` in `tenant/mcp.rs`; `type_for` behind the ontology functions<br>**Tests** `mcp::grants_never_exceed_the_user`, `authorization_code_flow_and_tools`, `ontology_tools_stay_within_the_grant` |
| An authorization code yields tokens only at its organisation's token endpoint, once, for its client and redirect URI, with the PKCE verifier; a replay revokes the grant | **Lean** `Mcp.exchangeCode_issued`, `exchangeCode_requires_pkce`, `exchangeCode_org_bound`, `exchangeCode_replay`, `exchangeCode_preserves_other_tenants`<br>**Rust** `oauth::exchange_code`<br>**Tests** `mcp::tokens_are_bound_to_client_verifier_and_org`, `authorization_code_flow_and_tools` |
| A refresh token works once, for its client, in its organisation; reusing a rotated-out one revokes the grant | **Lean** `Mcp.refreshGrant_issued`, `refreshGrant_rotated_out`, `refreshGrant_preserves_other_tenants`<br>**Rust** `oauth::refresh`<br>**Tests** `mcp::refresh_tokens_rotate`, `grants_never_exceed_the_user` |
| A grant is revoked only by its own client, at its organisation, and stays revoked: none of its tokens work afterwards | **Lean** `Mcp.revokeGrant_other_client`, `revokeGrant_ends`, `revokeGrant_preserves_other_tenants`, `Auth.verifyTenant_requires_session`<br>**Rust** `oauth::revoke_token`, `members::revoke_my_session`, `members::revoke_member_sessions`<br>**Tests** `mcp::tokens_can_be_revoked`, `sessions_and_grants_can_be_revoked` |
| An authorization request continues only in its browser, and consent needs the email code and, when required, the second factor | **Lean** HTTP-level; the 2FA gate is `Mfa.partial_session_gate`<br>**Rust** `oauth::open_request`, `oauth::current_step`, `mfa::may_enroll`<br>**Tests** `mcp::authorization_requests_are_bound_and_validated`, `authorization_requires_the_second_factor`, `security_keys_can_be_enrolled_during_authorization` |

### Rate limits

| Invariant | Evidence |
|---|---|
| Within any window, a rate-limit key accepts at most its limit; refused requests use up nothing | **Lean** `RateLimit.limitRun_within`, `limitRun_from_empty`, `limitStep_refused`<br>**Rust** `RateLimiter::check`<br>**Tests** `rate_limit` unit tests, `limits::login_codes_are_limited_per_address_and_ip`, `second_factor_attempts_are_limited_per_user`, `oauth_endpoints_are_limited` |

### Ontology

| Invariant | Evidence |
|---|---|
| A removed property's values are unreadable at once and never again, also under a re-added property of the same name; the purge changes no read | **Lean** `Props.remove_hides`, `removed_never_read`, `add_empty`, `dead_irrelevant`, `purge_read`, `pstep_inv`<br>**Rust** `schema::assign_ids`, `values::from_stored`, `jobs::purge_removed_properties`, `ontology_strip`<br>**Tests** `ontology::removed_properties_vanish_at_once_and_are_purged_later`, `schema`/`values` unit tests |
| Validation marks are accurate for the rules version they name: a live object marked valid at its type's current rules version passes them, so an `enforced` type's live objects all do; writes pass the rules current when they run; a rules change marks nothing valid; unique values are unique among valid objects | **Lean** `Ontology.ontStep_inv` (`MarksOk`, `CheckedOk`, `UniqueOk`), `ontRun_inv`, `marks_sound`, `enforced_sound`, `createObject_checked`, `write_inv`, `changeSchema_pending`, `validate_checked`<br>**Rust** `values::check_object`, `jobs::validate_batch`/`check_objects`, `ValidationSummary`, `replace_unique_values`, `ontology_unique_values`<br>**Tests** `ontology::object_types_are_versioned_and_new_rules_apply_asynchronously`, `objects_are_checked_against_their_type`, `values` unit tests |
| Links connect objects of their link type's declared types within one organisation, and respect its cardinality, also when it changes; links of deleted objects and link types are never visible, and cardinality counts visible links only | **Lean** `Ontology.ontStep_inv` (`LinksOk`, `CardOk`), `addLink_inv`, `changeCardinality_inv`, `vis_live`, `deleteObject_hides`, `deleteLinkType_hides`, `addLink_accepted`, `changeCardinality_accepted`<br>**Rust** composite foreign keys and partial unique indexes in `migrations/20261026000001_ontology.sql`; `deleted_at` checks in `objects::visible_ends`, `run_query`, `put_link`, `patch_link_type`<br>**Tests** `ontology::links_join_declared_types_within_their_cardinality`, `deletions_are_instant_and_cleaned_up_later` |
| The background job's purges, validation and requeueing never change what reads show, validation marks aside | **Lean** `Ontology.job_view`, `Props.purge_read`<br>**Rust** `tenant/ontology/jobs.rs`<br>**Tests** `ontology::deletions_are_instant_and_cleaned_up_later`, `removed_properties_vanish_at_once_and_are_purged_later` |
| Custom validators are an oracle: an object is written, or marked valid by the job, only if every validator call its values owe passed; every live object marked valid at its type's current rules passed them | **Lean** `Ontology.withOracle_check`, `withOracle_idem`, `createObject_validated`, `validate_validated`, `ontRun_validated`<br>**Rust** `validators::run_validations`, `crate::validators`; immutable `ontology_validators` versions<br>**Tests** `validators::writes_pass_only_their_validators`, `without_the_sandbox_validated_writes_are_refused`, `escape_attempts_fail`, `resource_bombs_fail_within_their_limits`, `isolation::role_privileges_are_minimal` |
| Ontology access needs its permission; restricted types only through owners or grants; editing includes viewing; schema changes need `manage_ontology` and view access; OAuth grants never change the schema | **Lean** `Ontology.typePermitted_permitted`, `typePermitted_restricted`, `mayEdit_needs_edit`, `mayManage_needs_view`, `scoped_never_manages`<br>**Rust** `TenantTx::permitted_on_type`, `check_type_access`, `type_to_manage`<br>**Tests** `ontology::ontology_permissions_and_restricted_types` |
| A live event stream delivers only its own organisation's events, and only those whose every object type its subscriber may view when the event is read; resuming from a cursor not older than what was pruned misses no event | **Lean** `Live.deliver_own_tenant`, `deliver_viewable`, `deliver_mayView`, `deliver_permitted`, `deliver_complete`, `append_after`, `resume_complete`, `append_inv`, `prune_inv`<br>**Rust** `events::Reader::read` (re-authenticated `TenantTx`, `permitted_types`), `events::record` (counter row), RLS on `ontology_events`<br>**Tests** `live::streams_deliver_only_their_organisation_and_viewable_types`, `changes_stream_live_and_resume_without_gaps`, `streams_end_with_their_session`, `pruned_cursors_reset_and_streams_are_limited` |

## Trusted, not proven

A proof is only as good as its assumptions. These are trusted rather than
modelled:

* **Cryptography.** Ed25519 signatures, HKDF, SHA-256, and TOTP and WebAuthn
  verification are oracles in Lean: the models assume a signature verifies
  only under its key and a hash identifies its input.
* **Postgres.** Its implementation of row-level security, triggers, row
  locks, and transactions. The models describe what the policy says;
  Postgres is trusted to do it. The tests run against a real Postgres to
  check the two agree.
* **Libraries.** `jsonwebtoken`'s claim checks and `webauthn-rs`'s
  ceremony checks.
* **The value checker.** The ontology's checker is a parameter of the Lean
  model. Its one assumed property, that stored values check again unchanged,
  is tested (`values::tests::normalisation_is_a_fixed_point`).
* **Custom validators.** An oracle the model assumes nothing about, treated
  as a function of its value. Monty makes that true up to the per-run
  clock, fixed when a run starts, so a validator that reads the time may
  fail later on an object it once passed.
* **The sandbox.** Monty's isolation (no OS access) and its resource limits
  are trusted and tested (`tests/validators.rs`), not modelled.
* **HTTP plumbing.** Cookies, CSP, CORS, and the browser binding of an
  authorization request are tested at the HTTP level, not modelled.
