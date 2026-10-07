# omp-deep-research

**Gajae Code의 autoresearch에서 착안한 Oh My Pi 전용 조사 확장입니다.** 웹·로컬 데이터·실험에서 근거를 모아 구조화된 결론을 남깁니다. OMP 코어를 포크하지 않으며 기존 `/autoresearch` 명령을 변경하지 않습니다.

> 버전 0.3.0입니다. 단위·어댑터 계약 테스트와 OMP 18.6.1/18.7.0 실제 실행 결과는 [VERIFICATION.md](docs/VERIFICATION.md)에 기록했습니다.

```text
/deep-research [--mode …]
  → (모드 없으면) intake: 목표·제약·결과물·모드 확인 → deep_research start
  → 원문 읽기 / 허용된 데이터 실험(autoresearch.sh 하네스)
  → 도구 결과 영수증 → 근거 원장
  → 선택적 critic 검토
  → conclusive / inconclusive verdict
  → 요청 시 report.md + mission.json + ledger.jsonl
```

## OMP autoresearch와의 차이

| | 기존 OMP `/autoresearch` | 이 확장 `/deep-research` |
|---|---|---|
| 목적 | 지표를 개선하는 코드 실험 | 근거를 수집해 질문에 답하기 |
| 결과 | 최적화 변경과 실험 결과 | 출처·실험 기록·구조화된 결론 |
| 제품 코드 수정 | 원래 최적화 워크플로의 일부 | 이 확장의 조사 범위 밖 |
| Git commit/revert | 원래 기능에 맡김 | 실행하지 않음 |

Gajae의 스킬이나 CLI를 그대로 복사한 호환 레이어는 아닙니다. `gjc`, `.gjc/` 상태, Gajae의 Python 커널, goal 명령에 의존하지 않습니다. 차이는 [호환성 문서](docs/COMPATIBILITY.md)에 정리했습니다.

## 1. 설치

OMP 18.6.1 이상이 필요합니다. 런타임 외부 의존성이 없어 빌드 없이 OMP 플러그인 관리자로 설치합니다. OMP는 git 플러그인을 `bun install`로 받으므로 `bun`이 `PATH`에 있어야 합니다(없으면 `Executable not found in $PATH: "bun"` 오류).

```bash
omp plugin install github:hoon-ch/omp-deep-research#v0.3.0
omp plugin list            # omp-deep-research 확인
```

설치할 때 OMP가 확장을 실제로 불러 초기화해 보고, 실패하면 설치를 되돌립니다. 새 버전은 새 태그로 다시 설치합니다(`#v0.3.0` 등). 태그 없이 `github:hoon-ch/omp-deep-research`로 설치하면 기본 브랜치를 따라가며 `omp plugin upgrade omp-deep-research`로 갱신합니다. 끄거나 지우려면 `omp plugin disable|uninstall omp-deep-research`를 씁니다. 설치·업그레이드 후에는 열린 `omp` 세션을 다시 시작해야 반영됩니다.

이 저장소를 고치면서 쓰는 개발 머신에서는 체크아웃을 그대로 연결합니다. 저장소를 수정한 뒤 `omp`만 다시 시작하면 반영됩니다.

```bash
git clone https://github.com/hoon-ch/omp-deep-research ~/repos/omp-deep-research
omp plugin link ~/repos/omp-deep-research
```

설치 없이 한 번만 써 보려면 `omp -e /absolute/path/to/omp-deep-research`로 실행합니다. 플러그인으로 설치한 상태에서 `-e`를 같이 쓰거나 `~/.omp/agent/extensions/`에 복사본을 두면 같은 확장이 두 번 로드되므로 하나만 쓰십시오. `skills/deep-research/SKILL.md`만 복사하면 상태 도구가 등록되지 않으므로 동작하지 않습니다.

## 2. 사용 예시

OMP 입력창에서 다음처럼 실행합니다. `--mode`를 주면 바로 시작합니다.

```text
/deep-research --mode web OMP와 Gajae Code의 최신 멀티프로바이더 지원을 공식 문서와 소스로 비교해줘
```

`--mode` 없이 실행하면 **intake**가 열립니다. 에이전트가 `ask`로 목표·제약·결과물·모드를 확인한 뒤 `deep_research(op:"start")`로 미션을 만듭니다. 그 전에는 조사 도구가 모두 차단됩니다. 모드는 파일 존재 여부로 추론하지 않습니다.

```text
/deep-research 이 프로젝트의 직렬화 방식 중 어느 쪽이 빠른지 알아봐줘
```

작성해 둔 명세(spec) 파일로 질문 없이 바로 시작할 수도 있습니다. 모드 선언은 필수이며, Gajae의 `autoresearch-*` 키도 그대로 읽습니다.

```text
/deep-research --spec plan.md --harness --critic anthropic/claude-sonnet-5-5
```

```markdown
# n=200000에서 Float64Array 정렬이 비교 함수를 쓴 Array 정렬보다 빠른가?

deep-research-mode: data
deep-research-metric: ms
deep-research-metric-direction: lower

## Constraints
- bench.js는 수정하지 않는다

## Deliverables
- array baseline과 typed 반복 실험의 keep/discard
```

읽기 전용 로컬 데이터 조사:

```text
/deep-research --mode data 이 프로젝트의 기존 벤치마크 결과 파일을 읽고 병목 가설을 검토해줘
```

벤치마크 하네스로 baseline/keep/discard 실험을 반복하는 조사(Gajae autoresearch의 실험 루프):

```text
/deep-research --mode data --harness --metric latency_ms --direction lower --budget 4 --max-tools 40 기존 벤치마크로 JSON 파서 두 개의 지연 시간을 비교해줘. 제품 코드는 변경하지 마.
```

**`--harness`**는 작업 디렉터리 루트의 `autoresearch.sh` 한 파일만 `write`로 쓰고, 정확히 `bash autoresearch.sh`(동기 실행, 루트 디렉터리)만 실행하도록 허용합니다. 심볼릭 링크·하드 링크된 `autoresearch.sh`는 거부합니다. 그래도 하네스 내용은 에이전트가 작성한 **임의 코드**이므로 격리 기능이 아닙니다. 실험이 진행되면 편집기 위에 현재 세그먼트의 실행 표(baseline `b`, 최선 `*`, keep/discard, 제외 표시)가 나타납니다.

**`--allow-exec`는 임의 코드 실행 권한입니다.** OMP의 `bash`·`eval`을 모두 허용합니다. 두 옵션 모두 `data`/`mixed` 모드 전용입니다. 별도 작업 복사본이나 컨테이너에서 사용하고, 기존 OMP 승인 절차를 유지하십시오.

실행 권한 없이 data/mixed 미션을 시작해도 기존 근거를 버릴 필요가 없습니다. intake나 `--spec`으로 시작한 미션도 같습니다. 실험이 필요하면 에이전트가 다음 사용자 명령을 안내합니다.

```text
/deep-research allow harness
/deep-research resume
```

`allow harness`는 하네스만 허용하며 기존 `exec` 권한을 해제합니다. 임의 `bash`·`eval`이 필요하면 대신 `allow exec`를 사용합니다. `deny`는 두 권한을 모두 해제합니다. 세 명령은 목표·근거·실행 기록·현재 예산과 상태를 유지하고 `execution_set` 이벤트를 원장에 기록합니다. `resume`은 미션이 일시정지된 경우에만 필요합니다.

권한 부여는 active/paused 상태의 data/mixed 미션에서만 가능합니다. web 미션이면 먼저 `mode data` 또는 `mode mixed`로 변경하세요. intake 중이거나 completed/cancelled 상태에서는 권한을 변경할 수 없습니다. 권한이 남아 있으면 web으로 전환하기 전에 `deny`를 실행해야 합니다.

`deny`는 이후 활성 미션의 실행 도구 호출을 차단합니다. 이미 실행 중인 명령을 종료하지 않으며, 일시정지하면 기존 정책대로 부모 세션의 도구 제한이 해제됩니다. `ask` 응답이나 에이전트 도구 호출은 실행 권한을 부여하지 않습니다.

## 3. 명령과 예산

| 명령/옵션 | 동작 |
|---|---|
| `/deep-research <objective>` | intake 시작. 에이전트가 확인 후 `start` 호출. UI가 없는 print/json 모드에서는 거부 |
| `/deep-research --mode … <objective>` | 명시한 모드로 미션 즉시 시작 |
| `/deep-research --spec <file>` | 명세 파일로 즉시 시작. 경로와 SHA-256을 기록 |
| `/deep-research` 또는 `help` | 사용법만 표시. 자동으로 조사하지 않음 |
| `/deep-research status` | 목표, 현재 상태, 출처 수, 예산·사용량, 세그먼트, 마지막 결론, 대기 중인 intake |
| `/deep-research runs` | 현재 세그먼트 실행 표 전체 |
| `/deep-research mode web\|data\|mixed` | 열린 미션의 모드 변경(사용자 전용). 기존 근거는 유지 |
| `/deep-research allow harness\|exec` | 열린 data/mixed 미션의 실행 권한 대체. `harness`는 기존 `exec` 해제 |
| `/deep-research deny` | 열린 미션의 두 실행 권한 해제. 실행 중인 명령은 종료하지 않음 |
| `/deep-research pause` | 현재 패스를 일시중지하고 중단 요청 |
| `/deep-research resume` | 근거와 이전 결론을 유지하며 새 예산의 패스 시작 |
| `/deep-research cancel` | 미션 또는 intake 취소. 자동 재시작 없음 |
| `/deep-research clear` | 현재 미션(또는 intake)을 논리적으로 정리. 원장은 삭제하지 않음 |
| `/deep-research export` | 새로운 로컬 폴더에 Markdown·JSON·JSONL 저장 |
| `/deep-research reset-ledger` | 읽을 수 없는 원장(버전 불일치·손상)을 재생 대상에서 제외. 기록은 세션에 남음 |
| `--mode web\|data\|mixed` | 생략하면 intake. 파일 존재 여부로 모드를 추론하지 않음 |
| `--harness` | data/mixed 전용. `./autoresearch.sh` 작성과 `bash autoresearch.sh` 실행만 허용 |
| `--allow-exec` | data/mixed 전용. `bash`·`eval` 전체 허용 |
| `--metric <name> --direction lower\|higher` | 주요 지표 선언. 첫 실행부터 강제 |
| `--budget 0..8` | 패스당 추가 자동 이어가기 요청 수. 기본 6 |
| `--max-tools 1..1000` | 패스당 부모 세션의 자료 수집 도구 호출 한도. 기본 60 |
| `--max-children 0..32` | 패스당 생성할 수 있는 서브에이전트(scout) 수. `task` 항목 하나가 1. 기본 8 |
| `--max-minutes 1..240` | 패스의 경과 시간 제한. 기본 20분 |
| `--max-tokens N`, `--max-cost USD` | 패스당 모델 사용량(토큰, 제공자 보고 비용) 한도. 메인 세션과 scout 사용량 합계 |
| `--critic provider/model` | 사용 가능한 별도 평가 모델 지정. 임의 대체하지 않음 |
| `--constraint "..."` | 제약 추가. 반복 지정 가능 |
| `--deliverable "..."` | 산출물 요구 추가. 반복 지정 가능 |

`--budget`은 전체 모델 호출 횟수가 아닙니다. 시간·도구·토큰·비용 예산은 부모 도구 호출/종료 경계에서 검사하며, 실행 중인 긴 명령을 강제 종료하지 않습니다. 토큰·비용은 메인 세션의 어시스턴트 응답과, 미션이 띄운 서브에이전트의 응답을 합산합니다. 미션이 중단되거나 예산을 소진했을 때 결론을 저장하지 못했다면, 이를 완료로 위장하지 않고 `paused`로 남깁니다.

헤드리스 실행은 `omp --mode rpc --no-ui`를 씁니다. `/deep-research --mode … <objective>`를 `prompt` 명령으로 보내고 `session_settled` 프레임까지 기다리면 미션이 끝까지 실행됩니다. OMP 18.6.1의 `omp -p`는 명령이 예약한 후속 턴을 실행하지 않고 종료하므로, 미션을 시작·재개하는 명령은 기록 전에 거부합니다. UI가 없을 때 `status`·`runs`·`export`·`help` 출력과 오류는 stderr로 나갑니다.

`resume`은 사용자의 명시적인 새 실행 요청입니다. 기존 패스의 자동 무한 연장이나 OMP 종료 후 백그라운드 실행이 아닙니다.

### 역할 분담: 싼 모델로 탐색, 좋은 모델로 판단

조사 대상이 서로 독립된 하위 질문 두 개 이상으로 나뉘면, 메인 에이전트는 `deep_research(op:"read", view:"explore")` 브리프를 받아 하위 질문마다 `scout`를 하나씩 한 번의 `task` 호출로 병렬 생성합니다. 이 항목들에는 `model`을 지정하지 않으므로 OMP의 scout 기본 역할(`@smol`, 사용자 설정 `task.agentModelOverrides.scout`)이 적용됩니다. scout는 출처 위치·발췌·지지/반박 여부를 담은 **단서**만 돌려주고, 메인 에이전트(기본 모델)가 유망한 원문을 직접 `read`해서 근거로 기록합니다. 즉 검색·훑어보기는 싼 모델이, 출처 판단·근거·결론은 좋은 모델이 맡습니다.

미션이 활성일 때 생성된 scout는 미션에 묶입니다.
- `data` 모드면 scout의 웹 접근도 막힙니다.
- 미션이 일시중지·취소되거나 시간·토큰·비용 예산을 넘으면 scout의 다음 도구 호출이 막힙니다.
- scout의 토큰·비용은 메인 세션이 다음 이벤트에서 원장에 기록하며, 상태줄에 `tok (scouts N)`으로 따로 보입니다.

이 연결은 OMP 18.6.1이 서브에이전트를 같은 프로세스에서 실행하고 확장을 자식 세션에 다시 바인딩하는 동작에 기대고 있습니다.

## 4. 에이전트가 사용하는 도구

등록되는 도구 이름은 충돌을 줄이기 위해 `deep_research` 하나입니다.

| `op` | 내용 |
|---|---|
| `read` | 요약, 전체 미션, 최근 도구 영수증, 세그먼트별 실행, 탐색 브리프, critic 브리프, 다음 실험 브리프. `view: "summary"\|"full"\|"receipts"\|"runs"\|"explore"\|"critic"\|"iterate"` |
| `start` | 대기 중인 intake를 확인된 목표·모드·제약·결과물(선택: 지표)로 미션으로 전환. 예산·실행 권한은 변경 불가 |
| `evidence` | 원문 읽기 결과와 연결된 근거 추가. 같은 출처·주장·stance는 중복 제거 |
| `segment` | 작업량·측정 방식·지표가 바뀌어 이전 실행과 비교할 수 없을 때 새 세그먼트 시작 |
| `run` | 실제 출력의 `METRIC`으로 baseline/keep/discard/crash/checks_failed 기록. `ASI` 줄도 함께 보존 |
| `flag_run` | 부정확하거나 조작된 실험 제외, 최선 지표 재계산 |
| `notes` | 가설·관찰·다음 시도를 보존 |
| `critic` | 검토자, 응답 영수증, 생성한 `task` 영수증 기록. 판정·우려사항·검토한 근거 ID·스냅샷 다이제스트는 critic의 구조화된 응답에서 가져옴 |
| `verdict` | 출처에 연결된 findings와 caveats를 갖춘 결론 저장. 반대 근거는 인용하거나 caveat에서 ID로 다뤄야 함 |
| `export` | 로컬 산출물 명시적 생성 |

웹 근거에는 그 URL을 실제로 연 `read` 영수증이 필요합니다. 요청한 URL과 호스트가 보고한 최종 URL(리다이렉트 결과)만 인정하며, 본문에 등장한 링크는 `links`에 따로 저장되는 다음 조사 후보일 뿐입니다.

파일 근거는 실제로 본 줄 범위를 인용합니다(`src/a.ts:10-20,30; docs/b.md:4`, `N+K`, `#L5-L9`도 가능). 각 범위는 그 영수증이 보여 준 줄 안에 있어야 합니다. 파일을 읽은 `read`의 표시 줄, 또는 그 파일에서 매치를 반환한 `grep`·`ast_grep`의 매치·문맥 줄이 기준입니다. 범위 없이 파일만 적으면 파일 전체를 인용한 것으로 보며, 파일 전체를 보여 준 `read`가 필요합니다. 근거 위치는 `경로[:범위]` 항목과 선택적 `(메모)`만 `;`로 이어 적을 수 있고, `a.ts and b.ts`나 `server.js lines 2-4`처럼 다른 텍스트가 섞이면 검사되지 않은 파일이 숨을 수 있으므로 거부합니다. 여러 파일을 한 번에 읽은 `read`(`a;b`)는 호스트가 파일별 줄 정보를 주지 않으므로 줄 범위 근거로 쓸 수 없습니다. 디렉터리 읽기, 매치가 없는 검색, scout 보고서(`agent://<id>`를 읽은 것), `task` 요약, 검색 스니펫, `github` 결과는 단서일 뿐 근거로 기록되지 않습니다.

경로가 존재한다는 사실만 기록하려면 `glob`·`find` 영수증으로 `"source": "listing"` 근거를 남깁니다. 줄 범위 없이 목록에 나온 경로만 인용할 수 있고, 파일 내용에 대한 주장의 근거가 되지는 않습니다. 이 구분은 critic 브리프와 보고서에 출처 종류로 드러납니다. 실제 출처의 진실성이나 주장과의 논리적 부합성까지 자동 증명하는 것은 아닙니다.

미션이 활성인 동안 부모 세션 도구 정책(OMP 18.6.x 기준 이름):

| 분류 | 도구 |
|---|---|
| 항상 허용, 예산 미차감 | `deep_research`, `ask`, `todo`, `wait`, `think` |
| 허용, 예산 차감 | `read`, `grep`, `find`, `glob`, `ast_grep`, `web_search`, `recall`, 읽기 전용 `github` op, `agent:"scout"` `task` |
| `data` 모드에서 차단 | `web_search`, `github`, URL 경로를 가진 모든 도구 호출(`read`, `grep` 등은 URL을 직접 가져옴) |
| harness 권한(`--harness` 또는 `allow harness`, data/mixed)에서만 허용 | 루트 `autoresearch.sh`로의 `write`, 정확히 `bash autoresearch.sh` |
| exec 권한(`--allow-exec` 또는 `allow exec`, data/mixed)에서만 허용 | `bash`, `eval`, 루트 `autoresearch.sh`로의 `write` |
| 그 외 전부 차단 | `edit`, `ast_edit`, 그 밖의 `write`, `lsp`, `goal`, 알 수 없는 도구 등 |

intake 중에는 위 표와 무관하게 `deep_research`, `ask`, `todo`, `wait`, `think`만 허용됩니다.

쓰기에 `requestId`를 지정하면 동일 입력 재시도가 멱등 처리됩니다. 이미 결론을 저장한 뒤 응답이 유실되어 같은 요청을 반복해도 결론을 중복 저장하지 않습니다. 다른 입력에 같은 ID를 재사용하면 거부합니다.

## 5. 실험과 critic

`run`은 실험을 직접 실행하지 않습니다. `--harness`의 `bash autoresearch.sh`나 허용된 다른 도구로 실행한 결과가 아래와 같은 출력을 남겨야 합니다. 하네스는 실패 시 0이 아닌 종료 코드를 내야 하며(OMP가 오류 결과로 기록 → `crash`), 고정 시드·고정 작업량으로 결정적이어야 합니다.

```text
METRIC latency_ms=128.4
METRIC memory_mb=241
ASI variant=typed
ASI cache=cold
```

`METRIC` 줄이 하나라도 형식에 어긋나면 그 실행은 `checks_failed`입니다. `ASI` 줄은 학습용 메모로 실행 기록에 보존되며, 형식이 틀린 줄은 건너뜁니다.

주요 지표와 방향은 세그먼트 안에서 고정됩니다(`--metric`/명세/intake에서 선언하거나, 첫 실행으로 정해짐). 작업량·측정 방식·지표가 바뀌면 에이전트가 `op:"segment"`로 새 세그먼트를 시작하고, baseline·최선·keep/discard는 세그먼트마다 다시 계산됩니다. 세그먼트의 첫 유효 실행이 baseline이며, 이후 엄격히 개선되면 `keep`, 동률·악화면 `discard`입니다. 유효 실행이 3개 이상이면 Gajae의 run confidence와 같은 방식으로 `|최선 − baseline| / MAD`(effect/MAD)를 보여줍니다. 이는 통계적 유의성이 아니며 코드 commit/revert를 수행하지도 않습니다. 잘못된 지표, 실행 오류, 검사 실패, 제외된 실행은 계산에서 빠집니다.

다음 실험은 `deep_research(op:"read", view:"iterate")`의 플래너 브리프(Gajae `auto-iterate.md` 기반 지시문 + 현재 세그먼트 스냅샷 + 응답 스키마)로 계획합니다. 에이전트가 직접 따르거나 `scout`에 맡길 수 있습니다.

기본 조사 모델은 OMP의 현재 모델입니다. `--critic`을 지정하면 모델 선택자를 OMP의 공개 모델 조회 API로 해석합니다. 메인 모델과 같은 모델이거나 사용 불가능한 선택자는 미션 시작 전에 거부합니다. 메인 에이전트는 `deep_research(op:"read", view:"critic")`의 critic 브리프(Gajae `auto-critic.md` 기반 지시문 + 전체 근거·실험 스냅샷 + 다이제스트 + 응답 스키마)를, 그 모델 하나로 고정한 읽기 전용 `scout` 작업 항목에 `outputSchema`와 함께 전달합니다. 사용자 환경에 `scout`이나 해당 모델이 없다면 임의 코딩 에이전트/모델로 대체하지 않습니다.

Critic은 현재의 **전체 근거·실험 스냅샷**을 검토해야 합니다. 브리프 스냅샷에는 `evidenceDigest`가 들어 있고 critic은 응답에 이 값을 그대로 적습니다. `op:"critic"`은 판정·요약·우려사항·근거 ID·다이제스트를 메인 모델의 입력이 아니라 critic 응답에서 가져오며, 응답의 다이제스트가 현재 스냅샷과 다르면 거부합니다. 따라서 근거·실험·세그먼트가 바뀐 뒤 과거 응답을 다시 등록할 수 없고 새 critic을 실행해야 합니다.

`--critic` 지정 여부와 관계없이 모든 critic 기록은 그 critic을 만든 `task` 호출 영수증(`spawnReceiptId`, 필수)과, 그 호출이 만든 에이전트의 `agent://<id>`를 읽은 응답 영수증(또는 critic 응답이 하나뿐인 동기 `task` 결과)에 연결되어야 합니다. `task` 영수증은 에이전트마다 ID, 해당 작업 항목의 단일 모델 고정값, 호스트가 보고한 실행 모델(대체 모델 여부 포함), 그 에이전트의 작업 입력에 들어 있던 스냅샷 해시와 critic 지시문 포함 여부를 하나의 레코드로 묶습니다. 응답을 만든 바로 그 에이전트가 `evaluator` 모델로 실행되었어야 하므로, `--critic`이 없어도 critic 작업 항목에는 메인 모델과 다른 모델 하나를 고정해야 합니다. 또 그 에이전트의 작업 입력에 현재 스냅샷(키 순서·공백 무관, `notes` 제외)과 critic 지시문 전체(공백 무관)가 그대로 들어 있어야 합니다. 다이제스트만 맞추고 요약·수정·과거 스냅샷을 넘기거나 지시문을 줄이거나 고친 경우, 같은 batch의 다른 에이전트 응답은 거부합니다. 다만 지시문과 스냅샷 주변에 덧붙인 지시는 감지하지 못합니다. 호스트가 관측한 입력과 결과로 확인하는 방식이며, 제공자가 실제로 어떤 모델을 썼는지에 대한 암호학적 증명은 아닙니다. 지정된 critic의 유효한 `pass` 없이 `conclusive`를 기록하지 못하지만, 한계를 밝힌 `inconclusive`는 허용합니다.

## 6. 상태와 파일

권위 있는 원장은 OMP 세션의 활성 브랜치에 기록되는 custom entry입니다.

```text
io.github.hoon-ch.omp-deep-research.event.v1
```

이벤트를 읽을 때마다 현재 `getBranch()`에서 복원하므로 세션 전환·브랜치 이동·compaction 뒤에도 다른 브랜치의 근거를 섞지 않습니다. 같은 브랜치 끝에서는 복원 결과를 캐시합니다. 원장을 읽을 수 없으면(예: 더 새로운 버전이 쓴 이벤트) 조사 정책 상태를 알 수 없으므로 `deep_research` 외 도구 호출을 막고, `/deep-research reset-ledger`로 이전 이벤트를 재생 대상에서 제외할 수 있습니다. 내부 상태를 전역 변수나 별도 `.gjc/` 파일에 저장하지 않습니다. 영구 보관 여부는 OMP 세션 저장 방식에 따릅니다.

내보내기를 요청하면 작업 디렉터리에 아래 파일이 생깁니다.

```text
.omp/deep-research/<mission-id>-<export-id>/
  report.md
  mission.json
  ledger.jsonl
```

기존 파일을 덮어쓰지 않으며 심볼릭 링크로 된 내보내기 상위 디렉터리를 거부합니다. 세션 기록과 보고서에는 비공개 내용이 포함될 수 있습니다. 자동 commit·전송·텔레메트리는 없습니다. `clear`는 보안 삭제 기능이 아닙니다.

## 7. 테스트

런타임 외부 의존성이 없으므로 테스트 자체는 Node.js 22.6 이상에서 바로 실행됩니다.

```bash
npm test
```

타입 검사까지 포함한 개발 검증:

```bash
npm ci --ignore-scripts
npm run verify
npm pack --dry-run
```

GitHub Actions는 Node 22/24에서 `npm run verify`와 `npm pack --dry-run`을 실행합니다. 실제 검증 범위와 남은 OMP 실기 테스트는 [VERIFICATION.md](docs/VERIFICATION.md)를 확인하십시오.

## 설계 문서

- [아키텍처](docs/ARCHITECTURE.md)
- [OMP API 호환성과 원본 매핑](docs/COMPATIBILITY.md)
- [실행한 검증과 남은 검증](docs/VERIFICATION.md)
- [보안·개인정보 경계](SECURITY.md)
- [원본 출처와 MIT 고지](THIRD_PARTY_NOTICES.md)
