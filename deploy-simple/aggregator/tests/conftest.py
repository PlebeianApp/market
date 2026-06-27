"""Shared pytest config for the aggregator tests.

``deploy-simple/aggregator/pytest.ini`` sets ``pythonpath = .`` so the flat
modules here (``scraper``) are importable. ``write-policy.py`` is hyphenated and
cannot be imported by name, so ``test_write_policy.py`` loads it via
``importlib.util``.

Run with::

    pytest deploy-simple/aggregator/
"""
