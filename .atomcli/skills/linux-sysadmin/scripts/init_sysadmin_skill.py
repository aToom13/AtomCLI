#!/usr/bin/env python3
"""
Skill initialization script for creating new skill templates.
Usage: python init_skill.py <skill-name> --path <output-directory>
"""

import os
import sys
import argparse
from pathlib import Path

SKILL_TEMPLATE = """---
name: {skill_name}
description: {description}
---

# {skill_title}

## Purpose

TODO: Describe the purpose of this skill in 2-3 sentences.

## When to Use This Skill

TODO: Specify when this skill should be used. Be specific about trigger conditions.

## How to Use This Skill

TODO: Explain how to use the skill, referencing any bundled resources.

### Scripts

TODO: If applicable, describe scripts in `scripts/` directory.

### References

TODO: If applicable, describe reference materials in `references/` directory.

### Assets

TODO: If applicable, describe assets in `assets/` directory.
"""

EXAMPLE_SCRIPT = """#!/usr/bin/env python3
\"\"\"
Example script - customize or delete as needed.
\"\"\"

def main():
    print("Example script - replace with actual implementation")

if __name__ == "__main__":
    main()
"""

EXAMPLE_REFERENCE = """# Example Reference Document

This is an example reference file. Replace with actual reference material.

## Section 1

TODO: Add reference content here.
"""

EXAMPLE_ASSET = """Example asset file - replace with actual asset content.
"""

def create_skill(skill_name: str, output_path: Path):
    """Create a new skill directory structure with templates."""
    
    # Create main skill directory
    skill_dir = output_path / skill_name
    skill_dir.mkdir(parents=True, exist_ok=True)
    
    # Create SKILL.md
    skill_title = skill_name.replace('-', ' ').title()
    description = f"This skill should be used when users need {skill_name.replace('-', ' ')} functionality."
    
    skill_md_content = SKILL_TEMPLATE.format(
        skill_name=skill_name,
        description=description,
        skill_title=skill_title
    )
    
    (skill_dir / "SKILL.md").write_text(skill_md_content)
    
    # Create resource directories
    scripts_dir = skill_dir / "scripts"
    references_dir = skill_dir / "references"
    assets_dir = skill_dir / "assets"
    
    scripts_dir.mkdir(exist_ok=True)
    references_dir.mkdir(exist_ok=True)
    assets_dir.mkdir(exist_ok=True)
    
    # Create example files
    example_script = scripts_dir / "example_script.py"
    example_script.write_text(EXAMPLE_SCRIPT)
    example_script.chmod(0o755)
    
    (references_dir / "example_reference.md").write_text(EXAMPLE_REFERENCE)
    (assets_dir / "example_asset.txt").write_text(EXAMPLE_ASSET)
    
    print(f"✓ Created skill directory: {skill_dir}")
    print(f"✓ Created SKILL.md with template")
    print(f"✓ Created example files in scripts/, references/, and assets/")
    print(f"\nNext steps:")
    print(f"1. Edit {skill_dir / 'SKILL.md'} and customize the content")
    print(f"2. Add your scripts to {scripts_dir}")
    print(f"3. Add reference materials to {references_dir}")
    print(f"4. Add assets to {assets_dir}")
    print(f"5. Delete example files you don't need")

def main():
    parser = argparse.ArgumentParser(description="Initialize a new skill template")
    parser.add_argument("skill_name", help="Name of the skill (e.g., my-skill)")
    parser.add_argument("--path", default=".", help="Output directory path")
    
    args = parser.parse_args()
    
    output_path = Path(args.path)
    create_skill(args.skill_name, output_path)

if __name__ == "__main__":
    main()
