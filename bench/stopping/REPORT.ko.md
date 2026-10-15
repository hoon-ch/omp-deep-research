# Mission B: Evidence-aware Research Stopping

> 로컬 main 반영: H6 정책만 선별 적용하고 기존 critic packet v2 최적화는 보존했습니다. 아래 전후 수치는 main 결합 전 연구 브랜치의 기록이며, 결합된 main의 전체 스위트 성능을 새로 측정한 결과가 아닙니다. 개별 실행 로그는 가져오지 않았고 집계와 C07 오탐 원문만 보존했습니다. 실행 도구는 `bench/stopping/`에 분리해 기존 루트 `autoresearch.sh`와 다른 벤치마크를 변경하지 않았습니다.

## 로컬 main 통합 검증

기존 main `acb9fc0` 위에 H6 정책을 선별 적용했습니다. 기존 critic packet v2 구현과 루트 benchmark entrypoint는 수정하지 않았습니다.

- `npm run check`와 `npm test`: 통과, **126/126 테스트** 성공.
- 고정 case·scorer·23개 fixture의 checksum과 별도 harness의 shell syntax 검사: 통과.
- 결합된 main의 실제 OMP RPC smoke: C01 conclusive, C09 attested critic을 거친 conclusive, C10 inconclusive로 **3/3 정답**. C09 critic record에 현재 packet `snapshotHash`가 저장됐음도 확인했습니다.
- [통합 smoke 집계](results/main-integration-smoke.json)는 3-case 동작 확인이며, 아래의 과거 10-case 전후 수치와 합산하거나 전체 성능 재측정으로 취급하지 않습니다.
- C07 채점 오탐은 수정하지 않았습니다. 이 통합이 원래 `checks_failed` 기록을 pass로 바꾸지는 않습니다.

## 결과

**H6(task-dependent sufficiency + gap-based delegation)만 유지했습니다.** 독립 재측정에서 스위트당 acquisition은 378.5 → 79회로 79.1% 감소했습니다. 메인 세션의 실제 검증은 대부분 유지하고, 단순 질문을 선행 scout로 분해하던 비용을 줄였습니다.

**최종 재측정의 native 판정은 `checks_failed`입니다.** 고정 scorer가 C07의 올바른 단위 표현을 놓친 결과를 그대로 기록했습니다. 기준선에도 같은 유형의 오탐이 있습니다. 이를 수정하거나 성공 판정으로 덮어쓰지 않았습니다. 유지 결정을 내린 H6 실험 자체는 20/20 통과했으며, 이후 동일 코드 재측정에서 사실 오류가 아닌 scorer 한계를 확인했습니다. 모든 자동 gate를 완벽하게 통과했다고 주장하지 않습니다.

- 유효 기준선: native run #2 / commit `7d092d7` / [결과](results/baseline-valid/summary.json).
- 유지한 H6: native run #8 / commit `b290e6a` / [결과](results/h6-task-dependent/summary.json).
- 동일 코드 독립 재측정: native run #10 / [결과](results/final-confirm/summary.json), [C07 오탐 원문](results/scorer-false-negative.json).
- [native `log_experiment` 판정 내역](results/experiments.json). push·publish·GitHub issue 변경은 하지 않았습니다.

## 측정 조건과 기준선 유효성

[고정 case](cases.json) 10개를 매번 두 번씩 실행했습니다. 각 단계는 20미션이며 질문·정답·scorer·corpus는 변경하지 않았습니다. 입력 checksum은 [FROZEN.sha256](FROZEN.sha256)에 있습니다. 실제 실행은 OMP 18.11.0 RPC, Node.js 24.17.0, 연구 모델 `openai-codex/gpt-6.1-sol` / thinking `high`, scout와 critic은 `alibaba-token-plan/qwen3.8-flash`입니다. critic role은 `medium`으로 고정했습니다. memory와 model fallback은 비활성화했습니다.

최초 pilot에서는 quota fallback으로 모델이 바뀌어 일부 주 모델이 critic과 같아졌습니다. 이 307회 pilot은 유효 비교에서 제외했습니다. 이후 Grok을 고정하려던 native run #1도 403 credit 오류로 20미션 전부 실패했으며, acquisition 0회의 개선이 아니라 `checks_failed`로 기록했습니다. 인증된 서로 다른 모델로 얻은 run #2부터 비교했습니다. 유효 기준선의 두 스위트 acquisition은 각각 377회와 380회였습니다.

source-acquisition tool call은 main 및 모든 하위 세션 transcript에서 직접 셉니다. `task` wrapper는 제외하되 scout가 실행한 검색·읽기를 전부 포함합니다. 실패한 source 호출도 같은 규칙으로 셉니다. `--max-tools`의 기존 부모 예산과는 별도 측정입니다. 토큰은 cache-read를 포함한 모든 main/child `usage.totalTokens`의 합입니다. 자세한 계산은 [계측 정의](README.md#계측-정의)에 있습니다.

## 전후 지표

아래 '이후'는 선택된 가장 좋은 실험 값이 아니라 **동일 코드 독립 재측정**입니다. 각 열은 같은 20미션입니다. 스위트당 수치는 두 번의 10미션 스위트 평균입니다.

| 지표 | 기준선 | 독립 재측정 | 변화·해석 |
|---|---:|---:|---|
| acquisition 총합 / 스위트당 `total_acquisition_calls` | 757 / 378.5 | 158 / 79 | −79.1% |
| main acquisition / 스위트 | 81.5 | 79 | 실제 원문 검증은 대부분 유지 |
| child acquisition / 스위트 | 297 | 0 | 불필요한 탐색 분해 제거; critic은 계속 실행 |
| 총 token consumption | 12,042,490 | 6,055,765 | −49.7% |
| `tokens_per_mission` | 602,125 | 302,788 | 반올림한 평균 |
| `time_to_verdict_ms` 중앙값 | 170,285 | 125,115 | −26.5% |
| `research_completion_rate` | 100% (20/20) | 100% (20/20) | 올바른 inconclusive 포함 |
| `correctly_conclusive_rate` | 93.75% (15/16) | 93.75% (15/16) | 각 열의 C07 regex 오탐 1건 포함 |
| `correctly_inconclusive_rate` | 100% (4/4) | 100% (4/4) | C04·C10 모두 올바른 inconclusive |
| 전체 고정 채점 정확도 | 95% (19/20) | 95% (19/20) | 오탐을 원래 채점 결과에서 빼지 않음 |
| `premature_stop_count` / 스위트 | 0.5 | 0.5 | 각 열의 C07 오탐; 실제 새 조기 결론은 원문 검토에서 발견하지 않음 |
| `missing_required_evidence_count` / 스위트 | 0 | 0 | 필수 근거 group 누락 없음 |
| `unresolved_contradiction_count` / 스위트 | 0 | 0 | 모순이 남은 C10은 conclusive가 아님 |
| `verified_claim_coverage` | 96.67% | 96.67% | C07 regex 오탐 포함 |
| `source_diversity` | 4.3 | 3.65 | evidence의 서로 다른 파일 수 평균; 출판사 다양성은 아님 |
| 필수 critic 인용 | 2/2 | 2/2 | 성공한 검토·attestation을 거친 verdict |

유지 결정을 내린 H6 실험은 acquisition 72회/스위트, 총 5,696,580 tokens, 미션 평균 284,829 tokens, verdict 중앙값 124,007.5 ms였습니다. 20/20 정답, 필수 claim coverage 100%, 조기 종료·필수 근거 누락·미해결 모순 위반은 0이었습니다. 재측정은 코드 변경 없이 같은 입력에서 수행했으므로, acquisition 72 → 79의 변동도 숨기지 않았습니다.

## 일곱 가설과 native 판정

유지 기준은 현재 유지한 변형 대비 acquisition이 최소 10% 감소하고 품질이 악화되지 않는 것이었습니다. 숫자 개선만으로 품질 실패를 상쇄하지 않았습니다. H1–H5는 모두 폐기되어 H6는 유효 기준선에서 출발했습니다. H7만 유지된 H6 위에서 시험했습니다.

| 가설 | acquisition / 스위트 | 고정 채점 정확도 | native 결과 | 관찰 |
|---|---:|---:|---|---|
| H1 coverage 추적 | 359 | 100% | `discard` | −5.2%로 유지 기준 미달. main 호출은 줄었지만 child 탐색량은 거의 그대로 |
| H2 명시적 gap agenda | 370 | 95% | `discard` | −2.2%에 그침. 기존 C07 표현 오탐 유지 |
| H3 contradiction 해결 추적 | 432.5 | 90% | `checks_failed` | 수집량 증가. C07 두 반복의 고정 채점 실패로 gate 악화 |
| H4 source novelty / scout lead quota 제거 | 384.5 | 95% | `checks_failed` | C10에서 512를 선호해 conclusive로 끝낸 실제 신규 회귀 1건 |
| H5 evidence 등록 직후 가벼운 충분성 feedback | 378.5 | 90% | `checks_failed` | 수집량 개선 없음. C10의 실제 신규 conclusive 회귀 1건과 C07 오탐 |
| H6 task-dependent stopping / 필요한 gap만 위임 | 72 | 100% | `keep` | 모든 필수 fact와 critic 유지. 선행 탐색 분해 비용 제거 |
| H7 critic readiness 사전 점검 | 70.5 | 95% | `checks_failed` | H6 대비 품질 gate 실패(C07 표현 오탐). critic case 평균 호출도 5.5 → 7.5로 악화 |

H4·H5의 실제 조기 종료 회귀를 감지하고 원복했으므로 최종 코드에는 해당 변경이 없습니다. H7 역시 더 작은 primary metric만 보고 유지하지 않았습니다. 독립 재측정 run #10도 C07 오탐을 이유로 `checks_failed`로 남겼습니다.

## 더 일찍 멈춘 case와 올바르게 계속한 case

각 수치는 스위트 내 해당 case의 두 반복 평균입니다.

| Case | 요구 | 기준선 acquisition | 독립 재측정 | 최종 행동 |
|---|---|---:|---:|---|
| C01 | 단일 권위 출처: broker port | 23.5 | 3 | 7421과 admin 7422를 구분한 뒤 종료 |
| C02 | 여러 문서: controller·Raft·timeout | 27 | 7 | architecture와 config 등 필요한 출처를 계속 확인 |
| C03 | 해결 가능한 version 모순 | 28.5 | 4.5 | 1.4 FAQ의 168시간과 2.2의 72시간을 version history로 구분 |
| C04 | 없는 p99 partition 측정값 | 41 | 9 | 2,000을 latency 보장으로 바꾸지 않고 inconclusive |
| C05 | 최신 release와 compression default | 32 | 9 | 최신 2.4.1, 2.3의 lz4 도입, 2.4 zstd opt-in을 검증 |
| C06 | 네 가지 필수 operator 질문 | 75 | 6 | port·record size·SIGTERM·segment size 모두 답변 |
| C07 | 오해하기 쉬운 timeout 결과 | 40.5 | 10.5 | generic 10초와 Python 30초, server 설정의 범위를 확인 |
| C08 | 추가 수집의 정보 가치가 작은 license | 19 | 4.5 | LICENSE·README·NOTICE가 일치한 뒤 탐색 확대 없이 종료 |
| C09 | 필수 독립 critic | 43 | 7 | replication 5 / min-insync 3을 확인하고 attested critic 완료 |
| C10 | 해결되지 않은 512 / 1000 모순 | 49 | 18.5 | 두 숫자 중 하나를 고르지 않고 inconclusive |

C04·C05·C07·C10은 쉬운 질문처럼 일찍 끝내지 않았습니다. 특히 C10은 최종 재측정에서도 가장 많은 추가 검증을 수행했고, 출처가 모순을 해결하지 못하므로 올바르게 inconclusive로 종료했습니다. 이는 실패한 연구가 아니라 정답 disposition입니다.

## 충분성 모델과 구현 범위

새 수치 점수나 보편적 최소 출처 수 대신 `src/policy.ts`의 공유 `SUFFICIENCY_POLICY` checklist를 채택했습니다. coverage, claim support, authority, independence, contradiction resolution, freshness, remaining information gain, required evaluation을 질적으로 판단합니다.

- `src/policy.ts`: 적용 가능한 권위 출처부터 확인하고, substantial independent unresolved discovery gap만 scout로 위임하도록 안내합니다.
- `index.ts`: 시작 메시지의 강제 선행 fan-out을 제거합니다. non-final `session_stop`에도 같은 충분성 기준을 주어, 새 조사가 필요한지부터 판단하도록 합니다.
- 고정된 coverage JSON 저장 형식, 별도 sufficiency tool/API, 자동 conclusive 판정, source-count gate는 추가하지 않았습니다. H1의 별도 tracking 형식은 지표 개선이 충분하지 않아 폐기했습니다.
- Evidence Ledger 의미, structured verdict schema, critic snapshot hashing·model attestation, branch replay, 사용자 예산, 실행 동의와 research-only 제한은 유지했습니다. 충분성 판단만으로 provenance나 필수 critic을 건너뛸 수 없습니다.

## 회귀 검증과 증거

- `npm run check`: 통과.
- `npm test`: 116/116 통과, 실패·skip 0. 기존 provenance·critic·branch·budget·permission·pause/resume·cancellation·continuation 계약 검사를 유지했습니다. 문구나 wiring을 확인하는 새 영구 테스트는 추가하지 않았습니다.
- `shasum -a 256 -c bench/FROZEN.sha256`: case·scorer·23개 corpus 파일 전부 일치.
- 최종 runner 기본 설정의 실제 OMP smoke(C01·C09 각 1회): 2/2 정답, 필수 critic 포함. 경로를 벗어나는 label과 기존 label 재사용도 미션 시작 전에 거부됨을 확인했습니다. 이 2-case smoke는 전후 10-case 스위트 지표에 합산하지 않았습니다.
- 실제 OMP RPC에서 기준선과 각 가설을 실행했습니다. H6 및 최종 재측정 각각 20미션의 findings를 fixture와 대조했고, evidence ID가 저장된 evidence를 가리키는지 확인했습니다.
- 실제 기준선 transcript를 extension factory에 branch로 재생한 throwaway smoke에서 evidence 3개를 보존한 pause/resume, 새 pass, idempotent stop, pending-user 우선순위, cancel, completed branch의 stop 억제, budget/abort pause, 미션이 없을 때 native tool 비간섭을 확인했습니다. 이는 adapter smoke이며 실제 UI의 stop 이벤트를 새로 강제한 실험은 아닙니다.
- non-final continuation은 `continue:true` 상태를 유지하며 충분성 판단 context만 바뀝니다. 자동 verdict를 만들거나 모순·누락을 성공으로 간주하지 않았습니다.

## 남은 한계

1. **고정 scorer의 C07 오탐:** 기준선은 `30.0-second`, 재측정은 `request_timeout in seconds ... default of 30.0`을 올바른 근거와 함께 답했지만 regex가 일부 finding 표현을 놓칩니다. summary에는 두 경우 모두 30.0 seconds가 명시됩니다. 원문을 확인해도 고정 점수·native 판정은 바꾸지 않았습니다. 따라서 최종 보고의 95%와 `checks_failed`를 100% 또는 pass로 읽으면 안 됩니다.
2. **정책은 advisory:** LLM의 의미 이해를 기계적으로 증명하는 종료 solver가 아닙니다. 모델·주제·분해 전략이 달라지면 재평가가 필요합니다. H4·H5가 실제로 조기 결론을 만들었다는 점도 이 위험을 보여 줍니다.
3. **평가 범위:** 10개 local-data case와 2회 반복입니다. 최신성은 고정 release chronology로 검증하며 실제 웹의 변동·진짜 출판사 간 독립성·대규모 연구의 분포를 포함하지 않습니다. 여러 문서를 필요로 하는 C02가 있어도 조직 간 독립성을 보장하는 suite는 아닙니다.
4. **의미 검증의 한계:** scorer는 regex와 locator group을 검사할 뿐 자연어 entailment·source authenticity를 완전히 판정하지 못합니다. 최종 원문 검토에서 새 unsupported claim이나 잘못된 실제 조기 결론을 발견하지 않았지만, 모든 가능한 입력에 대한 0건 보장은 아닙니다.
5. **수명주기 범위:** 이 벤치마크 미션들은 자연스러운 추가 `session_stop` continuation을 사용하지 않았습니다. 해당 경로는 기존 계약 테스트와 실제 ledger adapter smoke로 검증했습니다. 실제 TUI interruption/branch/compaction 조합을 모두 다시 실행하지 않았습니다.
6. **호스트 경계:** child transcript를 통한 benchmark 계측은 host의 세션 저장에 의존합니다. 제품 자체는 여전히 child acquisition을 부모 `--max-tools`에 합산하지 않으며, async critic의 실행 중 fallback 탐지 등 기존 attestation 한계도 바꾸지 않았습니다. 이번 평가는 fallback을 껐습니다.
