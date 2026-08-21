#!/usr/bin/env python3
"""Validate the generic IFC reconstruction skill package and compatibility router."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


REQUIRED_REFERENCES = {
    "architectureSources.md",
    "intakeAndEvidence.md",
    "targetsAndTracer.md",
    "leafFamily.md",
    "assemblyAuthoring.md",
    "setoutAndDimensions.md",
    "modelAndProjection.md",
    "verificationAndHandoff.md",
    "readinessMatrix.md",
}

REQUIRED_EVAL_IDS = {
    "analytic-or-parametric-evidence",
    "complete-new-reconstruction",
    "incomplete-whole-file-coverage",
    "leaf-family-repair",
    "tessellation-only-source",
    "unsupported-drop-in-claim",
}

REQUIRED_DOCUMENT_TOPICS = {
    "CompositionType",
    "GlobalId",
    "UsageType",
    "base-quantity",
    "map conversion",
    "representation kind",
    "schema",
    "styles",
    "type coverage",
    "whole-file",
}


def fail(message: str) -> None:
    """Report one package-contract failure and stop with a nonzero exit status."""
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def read(path: Path) -> str:
    """Read one required UTF-8 package file or report that it is absent."""
    if not path.is_file():
        fail(f"missing required file: {path}")
    return path.read_text(encoding="utf-8")


def validate_links(skill_root: Path, root_text: str) -> None:
    """Require every progressive-disclosure playbook to be linked from the root skill."""
    linked = set(re.findall(r"\]\(references/([^)]+\.md)\)", root_text))
    missing_links = REQUIRED_REFERENCES - linked
    if missing_links:
        fail(f"root skill does not link references: {sorted(missing_links)}")

    reference_names = {path.name for path in (skill_root / "references").glob("*.md")}
    if reference_names != REQUIRED_REFERENCES:
        fail(
            "reference playbooks differ from the root routing contract: "
            f"{sorted(reference_names ^ REQUIRED_REFERENCES)}"
        )


def validate_markdown_links(skill_root: Path) -> None:
    """Resolve every local Markdown link in the suite and its compatibility entry."""
    markdown_files = [
        skill_root / "SKILL.md",
        *sorted((skill_root / "references").glob("*.md")),
        skill_root.parent / "reconstruct-infra-family" / "SKILL.md",
        skill_root.parent / "reconstruct-assembly" / "SKILL.md",
    ]
    for path in markdown_files:
        text = read(path)
        targets = re.findall(r"\[[^\]]+\]\(([^)]+)\)", text)
        for target in targets:
            path_part = target.split("#", maxsplit=1)[0]
            if not path_part or "://" in path_part or path_part.startswith("mailto:"):
                continue
            resolved = (path.parent / path_part).resolve()
            if not resolved.exists():
                fail(f"broken local link in {path}: {target}")


def validate_root(skill_root: Path, root_text: str) -> None:
    """Validate the root router's frontmatter, triggers, brevity, and executable routes."""
    frontmatter = re.match(r"^---\n(?P<body>.*?)\n---", root_text, re.DOTALL)
    if frontmatter is None:
        fail("root SKILL.md has invalid frontmatter")
    frontmatter_body = frontmatter.group("body")
    keys = re.findall(r"^([a-z-]+):", frontmatter_body, re.MULTILINE)
    if keys != ["name", "description"]:
        fail(f"root frontmatter must contain only name and description, found {keys}")
    if len(root_text.splitlines()) > 150:
        fail("root SKILL.md exceeds the 150-line routing budget")

    description = re.search(r"^description:\s*(.+)$", frontmatter_body, re.MULTILINE)
    if description is None:
        fail("root frontmatter description must be a single executable line")
    description_text = description.group(1).lower()
    for trigger in ("full ifc reconstruction", "ifc remodeling", "source-vs-authored", "refinement"):
        if trigger not in description_text:
            fail(f"root description is missing trigger phrase: {trigger}")
    lowered = root_text.lower()
    for route in ("Intake", "Evidence", "Targets", "Tracer", "Leaf", "Model", "Projection", "Verification", "Handoff"):
        if route.lower() not in lowered:
            fail(f"root skill is missing the {route} route")

    validate_links(skill_root, root_text)


def validate_content(skill_root: Path) -> None:
    """Validate genericity, document-fidelity coverage, eval scenarios, and compatibility."""
    compatibility_path = skill_root.parent / "reconstruct-infra-family" / "SKILL.md"
    assembly_router_path = skill_root.parent / "reconstruct-assembly" / "SKILL.md"
    package_files = [
        *sorted(
            path
            for path in skill_root.rglob("*")
            if path.is_file() and path.suffix in {".json", ".md", ".py", ".yaml"}
        ),
        compatibility_path,
        assembly_router_path,
    ]
    content = "\n".join(read(path) for path in package_files)
    lowered = content.lower()

    forbidden_literals = {
        "examples/" + "infra-bridge",
        "reference/" + "infra-bridge",
        "Infra-" + "Bridge.ifc",
        "infra-bridge-" + "prototype",
        "/" + "Users/",
    }
    found = sorted(value for value in forbidden_literals if value.lower() in lowered)
    if found:
        fail(f"package contains reconstruction-specific paths or names: {found}")

    evidence = read(skill_root / "references" / "intakeAndEvidence.md")
    for topic in REQUIRED_DOCUMENT_TOPICS:
        if topic.lower() not in evidence.lower():
            fail(f"document-fidelity profile is missing: {topic}")

    eval_path = skill_root / "scripts" / "evalCases.json"
    try:
        eval_data = json.loads(read(eval_path))
    except json.JSONDecodeError as error:
        fail(f"invalid eval case JSON: {error}")
    scenarios = eval_data.get("scenarios")
    if not isinstance(scenarios, list):
        fail("eval cases must contain a scenarios list")
    eval_ids = {
        scenario.get("id")
        for scenario in scenarios
        if isinstance(scenario, dict) and isinstance(scenario.get("id"), str)
    }
    if eval_ids != REQUIRED_EVAL_IDS:
        fail(f"eval scenario IDs differ from the required set: {sorted(eval_ids)}")
    last_run = eval_data.get("lastForwardTest")
    if not isinstance(last_run, dict) or last_run.get("passed") != len(REQUIRED_EVAL_IDS):
        fail("eval cases lack a complete fresh-agent forward-test record")

    compatibility = read(compatibility_path)
    if "../ifc-reconstruction/references/leafFamily.md" not in compatibility:
        fail("legacy leaf skill is not a thin router to the authoritative playbook")
    if len(compatibility.splitlines()) > 45:
        fail("legacy leaf compatibility router duplicates too much workflow")

    assembly_router = read(assembly_router_path)
    if "../ifc-reconstruction/references/assemblyAuthoring.md" not in assembly_router:
        fail("Assembly skill is not a thin router to the authoritative playbook")
    if len(assembly_router.splitlines()) > 45:
        fail("Assembly router duplicates too much workflow")

    metadata = read(skill_root / "agents" / "openai.yaml")
    for field in ("display_name:", "short_description:", "default_prompt:"):
        if field not in metadata:
            fail(f"agent metadata is missing {field}")
    if "$ifc-reconstruction" not in metadata:
        fail("agent metadata default prompt does not invoke $ifc-reconstruction")

    validate_markdown_links(skill_root)


def main() -> None:
    """Validate the skill root passed on the command line and print a stable success marker."""
    if len(sys.argv) != 2:
        fail("usage: validatePackage.py <skill-directory>")
    skill_root = Path(sys.argv[1]).resolve()
    root_text = read(skill_root / "SKILL.md")
    validate_root(skill_root, root_text)
    validate_content(skill_root)
    print("IFC reconstruction skill package is valid")


if __name__ == "__main__":
    main()
