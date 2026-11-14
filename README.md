# CodeBase

Scripts and reusable snippets by [Luki Hackwell](https://lukihackwell.com/).

**Website:** [codebase.lukihackwell.com](https://codebase.lukihackwell.com/)

The collection is generated from real source files in this repository. An empty
collection is shown until files have been published; the site does not substitute
example entries for missing content.

## Publish a script or snippet

Use the directory that matches the language:

| Directory | Accepted extensions | Catalogue language |
| --- | --- | --- |
| `nlsh/` | `.sh` | Shell |
| `nlsh/` | `.bash` | Bash |
| `nlpy/` | `.py` | Python |
| `nlps/` | `.ps1` | PowerShell |

Extensions are case-sensitive. Subdirectories are supported. Each file or
directory name must start with an ASCII letter or digit; remaining characters may
be ASCII letters, digits, dots, underscores, spaces, or hyphens. Each path segment
is limited to 128 characters, and the complete path, including its leading slash,
is limited to 512 characters. Prefer short names such as `check_certificate.py`.
Paths outside this policy are omitted from the catalogue.

Keep source files as plain UTF-8 text without Jekyll YAML front matter. Do not use
leading dots or underscores in source filenames or subdirectory names. The
`.gitkeep` placeholders are not catalogue entries.

### With the GitHub website

1. Open the appropriate directory in this repository.
2. Choose **Add file → Upload files** and select your source file.
3. Review the filename and contents, then commit the upload. If you use a new
   branch, merge its pull request into `main` when ready to publish.
4. Optionally add the file's metadata to `_data/catalog.yml` as described below.
5. Wait for **pages build and deployment** in the repository's **Actions** tab to
   complete successfully, then check the live website.

### With Git

In a local checkout, place the source file in the appropriate directory and edit
`_data/catalog.yml` if metadata is needed. Stage only the intended files, inspect
the staged changes with `git diff --cached`, and commit them. Push the branch to
GitHub and merge it into `main` when ready to publish. The existing Pages build
then regenerates the catalogue.

Never commit passwords, private keys, access tokens, or other secrets.

## Optional metadata

`_data/catalog.yml` maps exact repository paths, including the initial `/`, to
metadata. Remove its standalone `{}` line when adding the first entry. Metadata
does not create a publication: the corresponding source file must exist in an
accepted directory with an accepted extension and filename.

The following is a **template**, not an existing script or a claim about testing.
Replace its path and explanatory text with accurate information before use:

```yaml
"/nlpy/your_script.py":
  title: "Replace with a descriptive title"
  description: "Replace with an accurate description of the actual code."
  kind: "snippet"
  platforms: []
  tags: []
  requirements: ""
  usage: ""
  verification: ""
  license: ""
  updated: ""
```

All fields are optional:

| Field | Format and default |
| --- | --- |
| `title` | String, up to 160 characters. Defaults to the filename stem with underscores and hyphens replaced by spaces. |
| `description` | String, up to 1,000 characters. Defaults to empty. |
| `kind` | `"script"` or `"snippet"`. Defaults to `"script"`; use `"snippet"` for a reusable fragment. |
| `platforms` | Array of strings; defaults to `[]` (unknown). Declare only supported environments. |
| `tags` | Array of strings; defaults to `[]`. |
| `requirements` | String, up to 8,000 characters. Defaults to empty. Describe actual dependencies and privileges. |
| `usage` | String, up to 8,000 characters. Defaults to empty. Include reviewed usage instructions. |
| `verification` | String; defaults to empty. Record only checks actually performed and their environment. |
| `license` | String; defaults to empty. Do not infer a license from repository visibility. |
| `updated` | Empty string or a quoted date in `"YYYY-MM-DD"` form. Defaults to empty. |

`platforms` and `tags` each allow at most 20 items, with at most 64 characters per
item. Use YAML arrays for these two fields and strings for the other fields.
For multiline strings, YAML's `|` block syntax is supported. Always quote dates
to keep them as strings. Invalid catalogue data is rejected by the browser.

The language label is determined by the file's directory and extension. A `.sh`
file receives the generic **Shell** label; its extension does not establish which
shell interpreter it requires. A `.bash` file receives the **Bash** label. Document
the actual interpreter and version requirements in `requirements`. Supported
operating systems, test results, modification dates, and licenses are never
inferred from the language or build time. Metadata is displayed as text and does
not define external download or preview URLs.

## How publication works

The existing GitHub Pages build runs Jekyll. `catalog.json` is a Liquid template
with YAML front matter; it enumerates `site.static_files`, selects accepted source
files, and combines their paths with `_data/catalog.yml`. Every dynamic string or
array is JSON-encoded. The generated response has `schemaVersion: 1` and an
`entries` array.

The browser reads the generated catalogue and fetches selected code from the same
site. Code previews are limited to **256 KiB (262,144 bytes)**. Larger files can
still be accessed through their source links. Publishing or previewing a script
does not execute it on the server or in the browser.

Keep the Jekyll build enabled: adding `.nojekyll` or hosting the source tree
directly would leave `catalog.json` unrendered. Preserve `CNAME` for the custom
domain. A basic static file server alone does not render the catalogue template.

## Verification

From a checkout with Node.js installed, run the local tests:

```text
node --test
```

Those tests do not replace a Jekyll build. After publication, verify that the
GitHub Pages run for your commit succeeded, open
[`catalog.json`](https://codebase.lukihackwell.com/catalog.json), and confirm that
it contains JSON rather than Liquid tags. Check that the uploaded file appears
and its code preview matches the source.

## Rollback

Create a new commit that reverts the relevant change and publish it to `main`.
For a merged pull request, GitHub's **Revert** action creates a reversal pull
request; review and merge it. For a direct commit, GitHub Desktop provides
**History → right-click the commit → Revert Changes in Commit**; review the new
commit and push it. Keep the history intact and wait for the resulting Pages build
to succeed before verifying the website again.

## References

- [Jekyll static files](https://jekyllrb.com/docs/static-files/)
- [Jekyll data files](https://jekyllrb.com/docs/datafiles/)
- [Jekyll Liquid filters](https://jekyllrb.com/docs/liquid/filters/)
- [Adding files on GitHub](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository)
- [Reverting a pull request](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/reverting-a-pull-request)
- [Reverting a commit in GitHub Desktop](https://docs.github.com/en/desktop/managing-commits/reverting-a-commit-in-github-desktop)
