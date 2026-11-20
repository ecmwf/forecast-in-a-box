There are Domain Entities that are part of Request/Response fields in routers.
This is an undesirable leak -- it makes the backend fragile to internal refactorings causing contract breakages.

Locate all such cases, and propose a fix for them.


Note: a prompt like the above was executed once, and the result was refreshed during the overall review at commit
`a797ab8e`. No action has been taken yet due to low priority. The routes guideline (`routes/__init__.py`) tolerates
domain classes used directly by routes only if they are "explicitly marked in the code" -- the tables below flag
which ones are marked.

Since the previous version of this document, `GET /plugin/status` (`PluginsStatus`), `GET /run/outputAvailability`
and `GET /blueprint/get`'s `BlueprintGetResponse` no longer exist; the items below reflect the current routes.

Note to the Architect: maybe we should ease the restriction and allow `fiab-core` entities in route usage, or at least the simple/Id types,
otherwise we would have too much mirrorrings? Because the `fiab-core` types are already shared among independent components and thus
facing quite a scrutiny, unlike the internal-to-the-backend types.

---

## routes/plugins.py

| Endpoint | Contract | External types | Marked |
|---|---|---|---|
| GET /plugin/list | `PluginListing` returned directly | whole hierarchy from `domain/plugin/detail.py`; nested `PluginStoreEntry`, `PluginRemoteInfo` (`domain/plugin/store.py`), `PluginError`/`PluginErrors` (`domain/plugin/errors.py`), `PluginRefreshStrategy` (`domain/plugin/settings.py`); keys `PluginCompositeId` (fiab_core) | `detail.py` yes (module docstring); `store.py`, `errors.py` no |
| POST /plugin/update, /install, /uninstall | `pluginCompositeId: PluginCompositeId` as body | `PluginCompositeId` (fiab_core) | no |
| GET /plugin/versions, /templateExampleValues | `PluginCompositeId` via `Depends()` query group | `PluginCompositeId` (fiab_core) | no |
| POST /plugin/settings | `PluginSettingsUpdateRequest` (route-local) | fields `PluginCompositeId`, `PluginRefreshStrategy` | no |
| GET /plugin/templateExampleValues | `TemplateExampleValuesResponse` (route-local) | values `BlueprintTemplateExampleInput` (fiab_core) | no |

## routes/admin.py

| Endpoint | Contract | External types | Marked |
|---|---|---|---|
| GET /admin/release | `GetReleaseStatusResponse` (route-local) | `local_release`, `newest_available_release: Release` -- a dataclass from `domain/admin/__init__.py` | no |
| POST /admin/release | `UpdateReleaseResponse` (route-local) | `release: Release` | no |
| GET /admin/settings | `ExportedSchemas` returned directly | TypedDict from `utility/rsjf/forms.py` | no |
| PATCH /admin/settings | `ExposedSettings` (route-local) as body | fields are `ExternalServicesSettings`, `BackendSettings`, `CascadeSettings` from `utility/config.py`, ie the config file schema is the contract | no |
| GET/PUT /admin/users* | `UserRead`, `UserUpdate` | `domain/auth/users.py`, inheriting `fastapi_users` schemas | accepted: this is the auth library contract |

## routes/run.py

| Endpoint | Contract | External types | Marked |
|---|---|---|---|
| GET /run/get, /run/list | `RunDetailResponse`, `RunOutputsResponse` (route-local) | `TaskId` (cascade.low.core) as keys of `outputs.outputs` and `lost_task_ids` | no |
| GET /run/getCompilationDetail | `CompilationDetailResponse` (route-local) | `CompilationDetailTask.task_id`, `.parents`: `TaskId` (cascade) | no |

`BlockInstanceId` (fiab_core) also appears in several fields; being a plain `str` NewType from the plugin contract
package, it is low risk.

## routes/blueprint.py

| Endpoint | Contract | External types | Marked |
|---|---|---|---|
| POST /blueprint/create, /update | route-local requests | `builder: BlueprintBuilder` (`domain/blueprint/service.py`; nested `RoutableBlock`, `EnvironmentSpecification` from `domain/blueprint/cascade.py`, `BlockInstance` from fiab_core); `tags: list[Tag]` (`domain/blueprint/service.py`) | `BlueprintBuilder`, `EnvironmentSpecification` yes ("NOTE warning -- this class is used by the web api"); `RoutableBlock`, `Tag` no |
| GET /blueprint/get, /list | `BlueprintDetail` (route-local) | `builder: BlueprintBuilder`, `tags: list[Tag]`, `source: BlueprintSource` (Literal from `schemata/blueprint.py`) | partially, see above |
| PUT /blueprint/expand | body is `BlueprintBuilder` directly; response `BlueprintValidationExpansionResponse` (route-local) | response fields `possible_sources: list[PluginBlockFactoryId]`, `possible_expansions: ...SerializedBlockExpansion` (both `domain/blueprint/service.py`), keys `BlockInstanceId`, `ConfigurationOptionId` (fiab_core) | `PluginBlockFactoryId`, `SerializedBlockExpansion` no |
| GET /blueprint/catalogue | `dict[PluginCompositeId, BlockFactoryCatalogue]` | both fiab_core | no (fiab_core is a published contract, arguably acceptable) |
| POST /blueprint/options/resolveDisplay | `ResolveDisplayRequest` (route-local) | `elements: list[ResolvableValue]` (`domain/blueprint/display.py`) | no |
| GET /blueprint/list | `BlueprintListFilters` (route-local) | `source: BlueprintSource` (schemata) | no |

## routes/artifacts.py

| Endpoint | Contract | External types | Marked |
|---|---|---|---|
| GET /artifacts/list_models | `list[MlModelOverview]` returned directly | dataclass from `domain/artifact/base.py`; fields `CompositeArtifactId`, `Platform` (fiab_core) | no |
| POST /artifacts/model_details | `MlModelDetail` returned directly | same as above | no |
| POST /artifacts/model_details, /download_model, /delete_model | `composite_id: CompositeArtifactId` as body | fiab_core | no |

## routes/status.py

| Endpoint | Contract | External types | Marked |
|---|---|---|---|
| GET /status | `StatusResponse` (route-local dataclass) | `concurrency: ExecutionStatus` from `utility/concurrency/manager.py`, with nested `PoolStatus`, thread statuses, `MonitoredFailure`, and `SerializeAsAny` per-component status models (eg `SchedulerStatus` from `domain/experiment/scheduling/runtime.py`) -- the internal monitoring shape is the contract | no |

## routes/lens.py

Mostly clean: `LensInstanceDetailResponse` already mirrors the domain `LensInstanceDetail`. Remaining: `status: LensStatus`
(Literal from `domain/lens/manager.py`) and `LensInstanceId` (NewType) -- low risk, but `LensStatus` should be
redeclared in the route module like `RunDetailStatus` in `routes/run.py`.

## Clean routes

`routes/gateway.py`, `routes/experiment.py`, `routes/notification.py`, `routes/auth.py` (the latter wraps `fastapi_users`
by design).

---

## Summary of actionable cases

| Priority | Issue | Proposal |
|---|---|---|
| high | `MlModelOverview`/`MlModelDetail` (domain dataclasses) returned directly | route-local pydantic response classes, mapped in the route |
| high | `ExecutionStatus` (utility internals) embedded in `/status` | route-local mirror classes, or explicitly mark the status models as part of the contract |
| medium | `PluginStoreEntry`/`PluginRemoteInfo`/`PluginError` nested in the marked `PluginListing` | either mark them as well, or mirror them inside `domain/plugin/detail.py` (or move `detail.py`'s classes into `routes/plugins.py`) |
| medium | `Release` in admin responses | route-local `ReleaseResponse(major, minor, patch)` or a string |
| medium | `Tag`, `RoutableBlock`, `PluginBlockFactoryId`, `SerializedBlockExpansion`, `ResolvableValue` | route-local mirrors, or mark them explicitly in `domain/blueprint` next to `BlueprintBuilder` |
| low | `BlueprintSource`, `LensStatus`, `PluginRefreshStrategy` literals imported from schemata/domain | redeclare the Literals in the route modules (as done with `RunDetailStatus`) |
| low | `TaskId` (cascade) in run responses | use `str` (or a route-local NewType) in the contract |
| low | fiab_core types (`PluginCompositeId`, `CompositeArtifactId`, `BlockFactoryCatalogue`, `BlueprintTemplateExampleInput`) | decide team-wide whether fiab_core counts as a published contract; if yes, document that in `routes/__init__.py`, if no, mirror |
| low | `ExposedSettings` exposing config classes | acceptable as long as config is append-only (which `development.md` requires anyway); document as a marked exception |
