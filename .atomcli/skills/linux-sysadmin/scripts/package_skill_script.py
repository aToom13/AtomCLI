#!/usr/bin/env python3
"""
Skill packaging script with built-in validation.
Usage: python package_skill.py <path/to/skill-folder> [output-directory]
"""

import os
import sys
import yaml
import zipfile
import argparse
from pathlib import Path
from typing import List, Tuple

class SkillValidator:
    """Validates skill structure and content."""
    
    def __init__(self, skill_path: Path):
        self.skill_path = skill_path
        self.errors: List[str] = []
        self.warnings: List[str] = []
        
    def validate(self) -> bool:
        """Run all validation checks. Returns True if valid."""
        self._check_skill_exists()
        if self.errors:
            return False
            
        self._check_skill_md()
        self._check_frontmatter()
        self._check_directory_structure()
        self._check_file_references()
        
        return len(self.errors) == 0
    
    def _check_skill_exists(self):
        """Check if skill directory exists."""
        if not self.skill_path.exists():
            self.errors.append(f"Skill directory does not exist: {self.skill_path}")
        elif not self.skill_path.is_dir():
            self.errors.append(f"Path is not a directory: {self.skill_path}")
    
    def _check_skill_md(self):
        """Check if SKILL.md exists and is readable."""
        skill_md = self.skill_path / "SKILL.md"
        if not skill_md.exists():
            self.errors.append("SKILL.md not found in skill directory")
        elif not skill_md.is_file():
            self.errors.append("SKILL.md is not a file")
        else:
            try:
                with open(skill_md, 'r', encoding='utf-8') as f:
                    self.skill_content = f.read()
            except Exception as e:
                self.errors.append(f"Cannot read SKILL.md: {e}")
    
    def _check_frontmatter(self):
        """Validate YAML frontmatter."""
        if not hasattr(self, 'skill_content'):
            return
        
        # Check for frontmatter delimiters
        if not self.skill_content.startswith('---'):
            self.errors.append("SKILL.md must start with YAML frontmatter (---)")
            return
        
        parts = self.skill_content.split('---', 2)
        if len(parts) < 3:
            self.errors.append("SKILL.md frontmatter not properly closed with ---")
            return
        
        frontmatter_text = parts[1].strip()
        
        try:
            frontmatter = yaml.safe_load(frontmatter_text)
        except yaml.YAMLError as e:
            self.errors.append(f"Invalid YAML frontmatter: {e}")
            return
        
        # Check required fields
        if not isinstance(frontmatter, dict):
            self.errors.append("Frontmatter must be a YAML dictionary")
            return
        
        if 'name' not in frontmatter:
            self.errors.append("Frontmatter missing required field: name")
        elif not isinstance(frontmatter['name'], str) or not frontmatter['name'].strip():
            self.errors.append("Frontmatter 'name' must be a non-empty string")
        
        if 'description' not in frontmatter:
            self.errors.append("Frontmatter missing required field: description")
        elif not isinstance(frontmatter['description'], str) or not frontmatter['description'].strip():
            self.errors.append("Frontmatter 'description' must be a non-empty string")
        else:
            # Check description quality
            desc = frontmatter['description']
            if len(desc) < 20:
                self.warnings.append("Description is very short (< 20 chars). Consider adding more detail.")
            if not desc[0].isupper():
                self.warnings.append("Description should start with a capital letter")
            if desc.startswith("This skill"):
                # Good! Follows convention
                pass
            else:
                self.warnings.append("Consider starting description with 'This skill should be used when...'")
        
        # Check naming convention
        if 'name' in frontmatter:
            name = frontmatter['name']
            if ' ' in name:
                self.errors.append("Skill name should not contain spaces (use hyphens instead)")
            if name != name.lower():
                self.warnings.append("Skill name should be lowercase")
            if '_' in name:
                self.warnings.append("Consider using hyphens instead of underscores in skill name")
    
    def _check_directory_structure(self):
        """Check optional resource directories."""
        allowed_dirs = {'scripts', 'references', 'assets', '__pycache__', '.git'}
        
        for item in self.skill_path.iterdir():
            if item.is_dir() and item.name not in allowed_dirs:
                self.warnings.append(f"Unexpected directory: {item.name}. Standard directories are: scripts/, references/, assets/")
    
    def _check_file_references(self):
        """Check if referenced files exist."""
        if not hasattr(self, 'skill_content'):
            return
        
        # Look for common file reference patterns
        import re
        
        # Pattern: scripts/filename, references/filename, assets/filename
        patterns = [
            r'scripts/([^\s\)]+)',
            r'references/([^\s\)]+)',
            r'assets/([^\s\)]+)'
        ]
        
        for pattern in patterns:
            matches = re.findall(pattern, self.skill_content)
            for match in matches:
                file_path = self.skill_path / match.replace('scripts/', 'scripts/').replace('references/', 'references/').replace('assets/', 'assets/')
                # Extract actual path
                if 'scripts/' in match:
                    file_path = self.skill_path / 'scripts' / match.split('scripts/')[-1]
                elif 'references/' in match:
                    file_path = self.skill_path / 'references' / match.split('references/')[-1]
                elif 'assets/' in match:
                    file_path = self.skill_path / 'assets' / match.split('assets/')[-1]
                
                if not file_path.exists():
                    self.warnings.append(f"Referenced file not found: {match}")
    
    def print_results(self):
        """Print validation results."""
        if self.errors:
            print("\n❌ VALIDATION FAILED")
            print("\nErrors:")
            for error in self.errors:
                print(f"  • {error}")
        
        if self.warnings:
            print("\n⚠️  Warnings:")
            for warning in self.warnings:
                print(f"  • {warning}")
        
        if not self.errors and not self.warnings:
            print("\n✓ Validation passed with no issues")
        elif not self.errors:
            print("\n✓ Validation passed (with warnings)")

def create_package(skill_path: Path, output_dir: Path) -> Path:
    """Create a zip package of the skill."""
    skill_name = skill_path.name
    zip_name = f"{skill_name}.zip"
    zip_path = output_dir / zip_name
    
    # Create output directory if it doesn't exist
    output_dir.mkdir(parents=True, exist_ok=True)
    
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(skill_path):
            # Skip hidden directories and cache
            dirs[:] = [d for d in dirs if not d.startswith('.') and d != '__pycache__']
            
            for file in files:
                # Skip hidden files and compiled Python
                if file.startswith('.') or file.endswith('.pyc'):
                    continue
                
                file_path = Path(root) / file
                arcname = file_path.relative_to(skill_path.parent)
                zipf.write(file_path, arcname)
    
    return zip_path

def main():
    parser = argparse.ArgumentParser(
        description="Package and validate a skill for distribution"
    )
    parser.add_argument(
        "skill_path",
        help="Path to the skill directory"
    )
    parser.add_argument(
        "output_dir",
        nargs='?',
        default='.',
        help="Output directory for the zip file (default: current directory)"
    )
    
    args = parser.parse_args()
    
    skill_path = Path(args.skill_path).resolve()
    output_dir = Path(args.output_dir).resolve()
    
    print("=" * 50)
    print("SKILL PACKAGING TOOL")
    print("=" * 50)
    print(f"\nSkill: {skill_path.name}")
    print(f"Path: {skill_path}")
    
    # Validate skill
    print("\n[1] Validating skill...")
    validator = SkillValidator(skill_path)
    is_valid = validator.validate()
    validator.print_results()
    
    if not is_valid:
        print("\n❌ Packaging aborted due to validation errors.")
        print("Please fix the errors above and try again.")
        sys.exit(1)
    
    # Package skill
    print("\n[2] Creating package...")
    try:
        zip_path = create_package(skill_path, output_dir)
        print(f"✓ Package created: {zip_path}")
        
        # Show package info
        file_size = zip_path.stat().st_size
        if file_size < 1024:
            size_str = f"{file_size} bytes"
        elif file_size < 1024 * 1024:
            size_str = f"{file_size / 1024:.1f} KB"
        else:
            size_str = f"{file_size / (1024 * 1024):.1f} MB"
        
        print(f"  Size: {size_str}")
        
        # Count files
        with zipfile.ZipFile(zip_path, 'r') as zipf:
            file_count = len(zipf.filelist)
        print(f"  Files: {file_count}")
        
    except Exception as e:
        print(f"\n❌ Packaging failed: {e}")
        sys.exit(1)
    
    print("\n" + "=" * 50)
    print("✓ PACKAGING COMPLETE")
    print("=" * 50)
    print(f"\nYour skill is ready for distribution: {zip_path}")
    print("\nNext steps:")
    print("1. Test the skill by importing it")
    print("2. Share the zip file with users")
    print("3. Users can import it via the skills menu")

if __name__ == "__main__":
    main()
