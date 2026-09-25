#!/usr/bin/env python3
"""Unit tests for rewrite-report-logo-cid.py — run: python3 this_file.py"""
from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "services/engagement-pipeline/scripts/rewrite-report-logo-cid.py"


def load_mod():
    spec = importlib.util.spec_from_file_location("rewrite_report_logo_cid", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


class RewriteLogoCidTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = load_mod()

    def test_rewrites_https_logo_to_cid_and_adds_height(self):
        html = (
            '<img src="https://storage.googleapis.com/aasik-refex-report-assets/refexone-logo.png" '
            'alt="refexOne" width="168" style="display:block; max-width:168px; height:auto;">'
        )
        out = self.mod.rewrite(html)
        self.assertIn('src="cid:refexone-logo"', out)
        self.assertIn('height="32"', out)
        self.assertNotIn("storage.googleapis.com", out)

    def test_rewrites_legacy_refex_logo(self):
        html = '<img src="https://cdn.example/refex-logo.png" width="100">'
        out = self.mod.rewrite(html)
        self.assertIn('cid:refexone-logo', out)
        self.assertIn('height="19"', out)

    def test_leaves_other_images_alone(self):
        html = (
            '<img src="https://storage.googleapis.com/aasik-refex-report-assets/refex-shimmer-divider-green.gif" '
            'width="680" height="6">'
        )
        self.assertEqual(self.mod.rewrite(html), html)

    def test_seed_itsm_template(self):
        path = ROOT / "db/seeds/itsm-engagement-template.html"
        html = path.read_text(encoding="utf-8")
        out = self.mod.rewrite(html)
        self.assertIn("cid:refexone-logo", out)
        self.assertIn("refex-shimmer-divider-green.gif", out)
        self.assertNotIn("refexone-logo.png", out)


if __name__ == "__main__":
    unittest.main()
