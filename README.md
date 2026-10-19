# omp-deep-research

**Gajae Code의 autoresearch에서 착안한 Oh My Pi 전용 조사 확장입니다.** 웹·로컬 데이터·실험에서 근거를 모아 구조화된 결론을 남깁니다. OMP 코어를 포크하지 않으며 기존 `/autoresearch` 명령을 변경하지 않습니다.

> 버전 0.5.0입니다. 단위·어댑터 계약 테스트와 OMP 실제 실행 결과는 [VERIFICATION.md](docs/VERIFICATION.md)에 기록했습니다.

```text
자연어 Deep Research 요청 → deep_research start
  또는 /deep-research [--mode …] → (모드 없으면) intake → deep_research start
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
omp plugin install github:hoon-ch/omp-deep-research#v0.5.0
omp plugin list            # omp-deep-research 확인
```

설치할 때 OMP가 확장을 실제로 불러 초기화해 보고, 실패하면 설치를 되돌립니다. 새 버전은 새 태그로 다시 설치합니다(`#v0.5.0` 등). 태그 없이 `github:hoon-ch/omp-deep-research`로 설치하면 기본 브랜치를 따라가며 `omp plugin upgrade omp-deep-research`로 갱신합니다. 끄거나 지우려면 `omp plugin disable|uninstall omp-deep-research`를 씁니다. 설치·업그레이드 후에는 열린 `omp` 세션을 다시 시작해야 반영됩니다.

0.3.0에서 업데이트할 때 `--critic`을 쓰면 `modelRoles.review_worker`를 설정하고 `--critic @review_worker`로 시작하세요. 업데이트 전에 요청했지만 아직 등록하지 않은 critic은 새 브리프로 다시 실행해야 합니다. 이미 등록된 과거 critic과 기존 근거·실험 원장은 유지됩니다. 설정과 재검토 조건은 [critic 안내](#5-실험과-critic)를 참고하세요.

이 저장소를 고치면서 쓰는 개발 머신에서는 체크아웃을 그대로 연결합니다. 저장소를 수정한 뒤 `omp`만 다시 시작하면 반영됩니다.

```bash
git clone https://github.com/hoon-ch/omp-deep-research ~/repos/omp-deep-research
omp plugin link ~/repos/omp-deep-research
```

설치 없이 한 번만 써 보려면 `omp -e /absolute/path/to/omp-deep-research`로 실행합니다. 플러그인으로 설치한 상태에서 `-e`를 같이 쓰거나 `~/.omp/agent/extensions/`에 복사본을 두면 같은 확장이 두 번 로드되므로 하나만 쓰십시오. `skills/deep-research/SKILL.md`만 복사하면 상태 도구가 등록되지 않으므로 동작하지 않습니다.

## 2. 사용 예시

슬래시 명령 없이 자연어로 Deep Research를 요청할 수 있습니다.

```text
Deep Research로 OMP와 Gajae Code의 최신 멀티프로바이더 지원을 공식 문서와 소스로 비교해줘
```

에이전트는 요청에 적힌 목표·범위·출처에서 모드를 정하고, 중요한 조건이 빠진 경우에만 질문합니다. 일반 질문이나 코딩 요청을 자동으로 조사 미션으로 바꾸지는 않습니다. 자연어 시작은 기본 예산(도구 60회, 하위 에이전트 8개, 20분, 추가 진행 6회), 실행 권한 없음, critic 없음으로 시작합니다. 이미 active/paused 미션이 있으면 덮어쓰지 않습니다. 예산이나 critic을 지정하려면 아래 명령을 사용하세요.

`--mode`를 주면 명시한 모드로 바로 시작합니다.

```text
/deep-research --mode web OMP와 Gajae Code의 최신 멀티프로바이더 지원을 공식 문서와 소스로 비교해줘
```

`--mode` 없이 실행하면 **intake**가 열립니다. 에이전트가 `ask`로 목표·제약·결과물·모드를 확인한 뒤 `deep_research(op:"start")`로 미션을 만듭니다. 그 전에는 조사 도구가 모두 차단됩니다. 모드는 파일 존재 여부로 추론하지 않습니다.

```text
/deep-research 이 프로젝트의 직렬화 방식 중 어느 쪽이 빠른지 알아봐줘
```

작성해 둔 명세(spec) 파일로 질문 없이 바로 시작할 수도 있습니다. 모드 선언은 필수이며, Gajae의 `autoresearch-*` 키도 그대로 읽습니다.

```text
/deep-research --spec plan.md --harness --critic @review_worker
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
| `--max-children 0..32` | 패스당 생성할 수 있는 서브에이전트 수. scout와 구성된 critic 모두 `task` 항목 하나가 1. 기본 8 |
| `--max-minutes 1..240` | 패스의 경과 시간 제한. 기본 20분 |
| `--max-tokens N`, `--max-cost USD` | 패스당 모델 사용량(토큰, 제공자 보고 비용) 한도. 메인 세션과 scout 사용량 합계 |
| `--critic @review_worker` | critic 모델 role 또는 `provider/model`. 플러그인의 `deep-research-critic` 에이전트가 그 모델로 검토. 임의 대체하지 않음 |
| `--constraint "..."` | 제약 추가. 반복 지정 가능 |
| `--deliverable "..."` | 산출물 요구 추가. 반복 지정 가능 |

`--budget`은 전체 모델 호출 횟수가 아닙니다. 시간·도구·토큰·비용 예산은 부모 도구 호출/종료 경계에서 검사하며, 실행 중인 긴 명령을 강제 종료하지 않습니다. 토큰·비용은 메인 세션의 어시스턴트 응답과, 미션이 띄운 서브에이전트의 응답을 합산합니다. 미션이 중단되거나 예산을 소진했을 때 결론을 저장하지 못했다면, 이를 완료로 위장하지 않고 `paused`로 남깁니다.

헤드리스 실행은 `omp --mode rpc --no-ui`를 씁니다. `/deep-research --mode … <objective>`를 `prompt` 명령으로 보내고 `session_settled` 프레임까지 기다리면 미션이 끝까지 실행됩니다. OMP 18.6.1의 `omp -p`는 명령이 예약한 후속 턴을 실행하지 않고 종료하므로, 미션을 시작·재개하는 명령은 기록 전에 거부합니다. UI가 없을 때 `status`·`runs`·`export`·`help` 출력과 오류는 stderr로 나갑니다.

`resume`은 사용자의 명시적인 새 실행 요청입니다. 기존 패스의 자동 무한 연장이나 OMP 종료 후 백그라운드 실행이 아닙니다.

### 역할 분담: 출처 탐색 필요에 따라 scout 배정

메인 에이전트는 하위 질문 개수만으로 scout를 생성하지 않습니다. 알려진 권위 출처나 저렴한 로컬 조회로 답할 수 있으면 직접 확인하고, 같은 출처를 조사하는 질문은 묶습니다. 상당한 불확실성이 있는 탐색에는 scout 하나를, 실질적으로 독립적인 탐색 작업에는 여러 scout를 고려합니다. 필요하면 집중 조사로 시작한 뒤 남은 근거 공백에 따라 확대합니다.

판단 기준은 정보 획득 기대와 **전체 작업량**입니다. 싼 모델의 가격이나 `task` 한 번의 도구 계수뿐 아니라 자식의 문맥·검색·응답, 결과 전달, 부모의 원문 재검증을 함께 고려합니다. 남은 토큰·비용·시간·도구·자식 예산을 확인하고, 구성된 critic이 아직 검토해야 하면 자식 슬롯을 남기도록 안내합니다. 이는 모델 행동 지침이며, 최적 scout 수나 critic 슬롯 예약을 코드가 보장하는 것은 아닙니다.

위임할 때는 `deep_research(op:"read", view:"explore")` 브리프를 받고 서로 다른 탐색 작업을 native `scout`에 전달합니다. `model`을 지정하지 않으므로 OMP의 scout 역할(`@smol`, 사용자 설정 `task.agentModelOverrides.scout`)이 적용됩니다. scout는 고정된 3–6개가 아니라 질문을 검증하기에 충분한 최소 출처 단서를 돌려줍니다. 메인 에이전트는 원문을 직접 읽어야 근거로 등록할 수 있습니다.

[실험 보고서](docs/SCOUT_ALLOCATION.md)에 고정 스위트, native autoresearch 기록, 실제 제공자 토큰, 재현 명령과 한계를 정리했습니다. 벤치마크는 전체 체크아웃에서 실행하며 배포 플러그인의 명령이나 도구 계약을 추가하지 않습니다.

미션이 활성일 때 생성된 scout는 미션에 묶입니다.
- `data` 모드면 scout의 웹 접근도 막힙니다.
- 미션이 일시중지·취소되거나 시간·토큰·비용 예산을 넘으면 scout의 다음 도구 호출이 막힙니다.
- scout의 토큰·비용은 메인 세션이 다음 이벤트에서 원장에 기록하며, 상태줄에 `tok (scouts N)`으로 따로 보입니다.

이 연결은 OMP 18.6.1이 서브에이전트를 같은 프로세스에서 실행하고 확장을 자식 세션에 다시 바인딩하는 동작에 기대고 있습니다.

### 근거 충분성과 조사 종료

추가 자료를 수집하기 전에 필수 질문·섹션의 충족 여부, 주장별 근거, 출처의 권위와 적용 범위, 필요한 독립 검증, 모순 해결, 최신성, 추가 정보의 가치, 설정된 critic 검토를 판단합니다. 문서상 사실은 적용 가능한 공식 출처 하나로 충분할 수 있지만, 경험적·비교·논쟁적 주장에는 추가 검증이 필요할 수 있습니다. 모든 질문에 같은 최소 출처 수나 신뢰도 임계값을 적용하지 않습니다.

근거가 충분하면 수집을 멈추고 필요한 검토와 구조화된 verdict를 완료합니다. 해결 가능한 중요한 정보 공백이 있으면 그 공백만 조사합니다. 필수 근거가 없거나 모순을 해결할 수 없거나 예산·명시적 권한이 부족하면 구체적인 제약을 적은 `inconclusive`가 올바른 결과입니다. 어려운 질문을 피하려고 `inconclusive`를 쓰지는 않습니다.

이는 에이전트의 판단을 안내하는 정책이며 자동 진실 판정기나 자동 완료 기능이 아닙니다. Evidence Ledger·verdict 스키마·provenance 검사·critic attestation·예산은 바뀌지 않습니다. `session_stop`도 새 검색부터 강요하지 않고 충분성 판단부터 요청하며, 기존 일시중지·취소·재개 규칙을 유지합니다.

`--max-tools`는 기존처럼 부모 도구 예산입니다. `task` 한 번의 예산 차감과 실제 조사량은 다릅니다. [종료 정책 벤치마크](bench/stopping/README.md)는 하위 세션의 검색·읽기까지 별도로 합산합니다. [실험 보고서](bench/stopping/REPORT.ko.md)에 유지·폐기 결과와 고정 scorer 오탐을 포함한 평가 한계를 기록했습니다.

## 4. 에이전트가 사용하는 도구

등록되는 도구 이름은 충돌을 줄이기 위해 `deep_research` 하나입니다.

| `op` | 내용 |
|---|---|
| `read` | 요약, 전체 미션, 최근 도구 영수증, 세그먼트별 실행, 탐색 브리프, critic 브리프, 다음 실험 브리프. `view: "summary"\|"full"\|"receipts"\|"runs"\|"explore"\|"critic"\|"iterate"` |
| `start` | 자연어 조사 요청을 기본 설정으로 시작하거나 대기 중인 intake를 미션으로 전환. 목표·모드·제약·결과물과 선택적 지표를 받음. 예산·실행 권한·critic은 변경 불가 |
| `evidence` | 원문 읽기 결과와 연결된 근거 추가. 같은 출처·주장·stance는 중복 제거 |
| `segment` | 작업량·측정 방식·지표가 바뀌어 이전 실행과 비교할 수 없을 때 새 세그먼트 시작 |
| `run` | 실제 출력의 `METRIC`으로 baseline/keep/discard/crash/checks_failed 기록. `ASI` 줄도 함께 보존 |
| `flag_run` | 부정확하거나 조작된 실험 제외, 최선 지표 재계산 |
| `notes` | 가설·관찰·다음 시도를 보존 |
| `critic` | 검토자, 응답 영수증, 생성한 `task` 영수증 기록. 판정·우려사항·검토한 근거 ID·스냅샷 다이제스트는 critic의 구조화된 응답에서 가져옴 |
| `verdict` | 출처에 연결된 findings와 caveats를 갖춘 결론 저장. 반대 근거는 인용하거나 caveat에서 ID로 다뤄야 함 |
| `export` | 로컬 산출물 명시적 생성 |

웹 근거에는 그 URL을 실제로 연 `read` 영수증이 필요합니다. 요청한 URL과 호스트가 보고한 최종 URL(리다이렉트 결과)만 인정하며, 본문에 등장한 링크는 `links`에 따로 저장되는 다음 조사 후보일 뿐입니다.

파일 근거는 실제로 본 줄 범위를 인용합니다(`src/a.ts:10-20,30; docs/b.md:4`, `N+K`, `#L5-L9`도 가능). 각 범위는 그 영수증이 보여 준 줄 안에 있어야 하며, 파일 전체를 보여 준 `read`라도 표시하지 않은 줄 번호(예: 3줄 파일의 `:999-1000`)는 거부합니다. 파일을 읽은 `read`의 표시 줄, 또는 그 파일에서 매치를 반환한 `grep`·`ast_grep`의 매치·문맥 줄이 기준입니다. 범위 없이 파일만 적으면 파일 전체를 인용한 것으로 보며, 파일 전체를 보여 준 `read`가 필요합니다. 줄 정보 없이 전체를 읽은 비텍스트 파일(PDF·이미지 등)은 범위 없이 파일만 인용할 수 있습니다. 근거 위치는 `경로[:범위]` 항목과 선택적 `(메모)`만 `;`로 이어 적을 수 있고, `a.ts and b.ts`나 `server.js lines 2-4`처럼 다른 텍스트가 섞이면 검사되지 않은 파일이 숨을 수 있으므로 거부합니다. 여러 파일을 한 번에 읽은 `read`(`a;b`)는 호스트가 파일별 줄 정보를 주지 않으므로 줄 범위 근거로 쓸 수 없습니다. 디렉터리 읽기, 매치가 없는 검색, scout 보고서(`agent://<id>`를 읽은 것), `task` 요약, 검색 스니펫, `github` 결과는 단서일 뿐 근거로 기록되지 않습니다.

실험 근거(`"source": "experiment"`)는 실험을 실행한 `bash`·`eval` 영수증이나 로컬 결과 파일을 읽은 영수증으로 기록합니다. 결과 파일 영수증은 파일 근거와 똑같이 검사하므로, 출처 종류를 바꿔도 그 영수증이 보여 주지 않은 파일·줄을 인용할 수 없습니다.

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

`run`은 실험을 직접 실행하지 않습니다. `--harness`의 `bash autoresearch.sh`나 exec 권한으로 실행한 `bash`·`eval` 결과가 아래와 같은 출력을 남겨야 하며, `run`에는 그 실행 영수증만 등록할 수 있습니다. 결과 파일을 읽은 `read`, scout 보고서(`agent://`), `task` 응답, 웹 페이지에 들어 있는 `METRIC` 줄은 측정이 아니므로 거부합니다. 기존 결과 파일의 수치는 실험 근거로 인용하세요. 하네스는 실패 시 0이 아닌 종료 코드를 내야 하며(OMP가 오류 결과로 기록 → `crash`), 고정 시드·고정 작업량으로 결정적이어야 합니다.

```text
METRIC latency_ms=128.4
METRIC memory_mb=241
ASI variant=typed
ASI cache=cold
```

`METRIC` 줄이 하나라도 형식에 어긋나면 그 실행은 `checks_failed`입니다. `ASI` 줄은 학습용 메모로 실행 기록에 보존되며, 형식이 틀린 줄은 건너뜁니다.

주요 지표와 방향은 세그먼트 안에서 고정됩니다(`--metric`/명세/intake에서 선언하거나, 첫 실행으로 정해짐). 작업량·측정 방식·지표가 바뀌면 에이전트가 `op:"segment"`로 새 세그먼트를 시작하고, baseline·최선·keep/discard는 세그먼트마다 다시 계산됩니다. 세그먼트의 첫 유효 실행이 baseline이며, 이후 엄격히 개선되면 `keep`, 동률·악화면 `discard`입니다. 유효 실행이 3개 이상이면 Gajae의 run confidence와 같은 방식으로 `|최선 − baseline| / MAD`(effect/MAD)를 보여줍니다. 이는 통계적 유의성이 아니며 코드 commit/revert를 수행하지도 않습니다. 잘못된 지표, 실행 오류, 검사 실패, 제외된 실행은 계산에서 빠집니다.

다음 실험은 `deep_research(op:"read", view:"iterate")`의 플래너 브리프(Gajae `auto-iterate.md` 기반 지시문 + 현재 세그먼트 스냅샷 + 응답 스키마)로 계획합니다. 에이전트가 직접 따르거나 `scout`에 맡길 수 있습니다.

기본 조사 모델은 OMP의 현재 모델입니다. critic은 `--critic`으로만 켜며, 값으로 OMP 모델 role이나 `provider/model`을 받습니다. 권장 값은 `--critic @review_worker`입니다. 선택자는 미션 시작 때 OMP의 모델 조회 API로 실제 모델로 해석하고, 메인 모델과 같거나 해석할 수 없으면 미션 시작 전에 거부합니다.

critic은 플러그인에 포함된 읽기 전용 에이전트 `deep-research-critic`(`agents/deep-research-critic.md`, 도구는 `read`만)이 맡습니다. 이 에이전트는 정의 파일의 `model: "@review_worker"`에 따라 `modelRoles.review_worker` 모델로 실행됩니다. OMP 18.8.2부터 `task` 작업 항목에서 모델을 직접 지정할 수 없으므로 이 role이 critic 모델을 정합니다. `--critic`은 이 role이 해석되는 모델과 같아야 합니다. 다른 role을 쓰려면 `task.agentModelOverrides`의 `deep-research-critic` 항목에 `"@<role>"` 형태로 지정하고 `--critic`도 같은 role로 맞추세요. 구체적인 모델 문자열로 덮어쓰면 호스트가 role을 보고하지 않아 critic을 검증할 수 없습니다. 메인 에이전트는 `deep_research(op:"read", view:"critic")`의 critic 브리프(Gajae `auto-critic.md` 기반 지시문 + 전체 근거·실험 스냅샷 + 다이제스트 + 응답 스키마)를 그 에이전트에 그대로 전달하며, 다른 에이전트나 모델로 대체하지 않습니다. `deep-research-critic`은 `--critic` 미션에서만 호출할 수 있습니다.

`--critic`을 지정하지 않은 미션에서는 에이전트가 critic 브리프를 읽거나 critic을 실행하지 않으며, 결론의 한계나 답변에 "critic 미실시"를 적지 않습니다.

Critic은 현재의 **모든 근거·실험을 담은 review packet**을 검토해야 합니다. `view:"critic"`의 `snapshot`은 `packet: "deep-research.critic-packet.v2"`, `serialization: "stable-json.v1"`을 명시합니다. 모든 근거의 ID·출처 종류·stance·제목·주장·요약·locator·원래 영수증 ID와 전체 실험 기록·요구사항·notes를 유지하며, 근거 등록 시각(`at`)과 중복 제거 키(`fingerprint`)만 critic에게 보내지 않습니다. 생략한 두 필드는 원장과 `evidenceDigest`에 남습니다. Critic이 생략된 필드까지 검토했다고 주장하지 않습니다.

Critic은 `evidenceDigest`를 그대로 복사하고 모든 근거 ID를 순서대로 응답해야 합니다. 근거 ID 수는 현재 미션과 정확히 일치해야 하며, 우려사항 배열의 100개 제한과 별개이므로 500개 근거도 검토할 수 있습니다. `op:"critic"` 입력과 critic 응답 schema는 바뀌지 않습니다. 엔진이 새 critic 기록에 전체 packet의 `snapshotHash`를 추가하고, verdict 시에도 현재 packet과 비교합니다. **검토 요청 뒤 notes나 mode가 바뀌어도 재검토가 필요합니다.** 검토 전에 notes를 정리하세요. 이미 등록된 구형 critic은 원래 digest 규칙으로 재생되지만, 업데이트 전에 생성했어도 아직 등록하지 않은 critic은 새 브리프로 다시 실행해야 합니다. 측정 방법과 한계는 [critic context 실험 보고서](docs/CRITIC_CONTEXT.ko.md)를 참고하세요.

`--critic` 지정 여부와 관계없이 모든 critic 기록은 그 critic을 만든 `task` 호출 영수증(`spawnReceiptId`, 필수)과, 그 호출이 만든 에이전트의 `agent://<id>`를 읽은 응답 영수증(또는 critic 응답이 하나뿐인 동기 `task` 결과)에 연결되어야 합니다. Host는 에이전트 ID, 호스트 보고 model role을 해석한 `roleModel`, 이전 OMP의 단일 model pin, 보고된 실행 모델/fallback, 그 에이전트에게 전달한 packet hash와 전체 critic 지시문을 함께 확인합니다. 응답을 만든 바로 그 에이전트가 `evaluator` 모델이어야 하며 보고된 실행 모델, 이전 pin, role 모델 순서로 확인합니다.

새 versioned packet은 **notes를 포함한 모든 값과 배열 순서**가 같아야 합니다. 객체 key 순서와 JSON 공백만 무관합니다. 요약·수정·과거 packet, 짧아지거나 바뀐 지시문, 같은 batch의 다른 agent 응답은 거부합니다. 다만 packet과 지시문의 존재 확인은 의미적으로 완전한 검토의 증명이 아니며, 주위에 덧붙인 지시도 감지하지 못합니다. 비동기 task에서 최종 실행 모델이 보고되지 않으면 role을 신뢰하므로 숨은 fallback을 완전히 감지하지 못합니다. 제공자의 실제 모델 실행을 암호학적으로 증명하는 방식은 아닙니다. 지정 critic의 유효한 `pass` 없이 `conclusive`를 기록하지 못하지만 한계를 밝힌 `inconclusive`는 허용합니다.

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
