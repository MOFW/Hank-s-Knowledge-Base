-- Local fixtures. Run only through db:seed, with the local bindings.
INSERT INTO users (id, display_name, role, created_at)
VALUES ('dffc285a-0e94-435b-ba15-869acc134a9d', '本地所有者', 'owner', '2026-11-11T00:00:00.000Z')
ON CONFLICT DO NOTHING;
INSERT INTO identities (id, user_id, provider, provider_scope, subject, created_at)
VALUES ('d96d418b-c19f-47cc-be7f-8cb6d1a95c24', 'dffc285a-0e94-435b-ba15-869acc134a9d', 'local', 'hkb-local', 'local_seedy', '2026-11-11T00:00:00.000Z')
ON CONFLICT DO NOTHING;
INSERT INTO system_state (id, updated_at)
VALUES (1, '2026-11-11T00:00:00.000Z')
ON CONFLICT DO NOTHING;
INSERT INTO courses (id, row_version, created_at, updated_at, created_by, updated_by, last_origin, extra_json, deleted_at, sort_order, name, slug, description_md, archived_at)
VALUES ('0cc6d2e9-33a7-4ce0-a096-992d29f32778', 1, '2026-11-11T00:00:00.000Z', '2026-11-11T00:00:00.000Z', 'dffc285a-0e94-435b-ba15-869acc134a9d', 'dffc285a-0e94-435b-ba15-869acc134a9d', 'system', '{}', NULL, 0, '高等数学', 'calculus', '从极限和连续出发，整理微分、积分与级数的概念和方法。', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO content_revisions (id, course_id, revision_no, snapshot_json, actor_id, origin, created_at)
VALUES ('0cc6d2e9-33a7-4ce0-a096-992d29f32778', '0cc6d2e9-33a7-4ce0-a096-992d29f32778', 1, '{"id":"0cc6d2e9-33a7-4ce0-a096-992d29f32778","rowVersion":1,"createdAt":"2026-11-11T00:00:00.000Z","updatedAt":"2026-11-11T00:00:00.000Z","createdBy":"dffc285a-0e94-435b-ba15-869acc134a9d","updatedBy":"dffc285a-0e94-435b-ba15-869acc134a9d","lastOrigin":"system","extraJson":{},"deletedAt":null,"sortOrder":0,"name":"高等数学","slug":"calculus","descriptionMd":"从极限和连续出发，整理微分、积分与级数的概念和方法。","archivedAt":null}', 'dffc285a-0e94-435b-ba15-869acc134a9d', 'system', '2026-11-11T00:00:00.000Z')
ON CONFLICT DO NOTHING;
INSERT INTO courses (id, row_version, created_at, updated_at, created_by, updated_by, last_origin, extra_json, deleted_at, sort_order, name, slug, description_md, archived_at)
VALUES ('7b3d9d25-36f5-4fa5-8b62-0428813bd685', 1, '2026-11-11T00:00:00.000Z', '2026-11-11T00:00:00.000Z', 'dffc285a-0e94-435b-ba15-869acc134a9d', 'dffc285a-0e94-435b-ba15-869acc134a9d', 'system', '{}', NULL, 10, '线性代数', 'linear-algebra', '从矩阵运算出发，理解线性方程组、向量空间和线性变换。', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO content_revisions (id, course_id, revision_no, snapshot_json, actor_id, origin, created_at)
VALUES ('7b3d9d25-36f5-4fa5-8b62-0428813bd685', '7b3d9d25-36f5-4fa5-8b62-0428813bd685', 1, '{"id":"7b3d9d25-36f5-4fa5-8b62-0428813bd685","rowVersion":1,"createdAt":"2026-11-11T00:00:00.000Z","updatedAt":"2026-11-11T00:00:00.000Z","createdBy":"dffc285a-0e94-435b-ba15-869acc134a9d","updatedBy":"dffc285a-0e94-435b-ba15-869acc134a9d","lastOrigin":"system","extraJson":{},"deletedAt":null,"sortOrder":10,"name":"线性代数","slug":"linear-algebra","descriptionMd":"从矩阵运算出发，理解线性方程组、向量空间和线性变换。","archivedAt":null}', 'dffc285a-0e94-435b-ba15-869acc134a9d', 'system', '2026-11-11T00:00:00.000Z')
ON CONFLICT DO NOTHING;
INSERT INTO chapters (id, row_version, created_at, updated_at, created_by, updated_by, last_origin, extra_json, deleted_at, sort_order, course_id, parent_id, title, slug, description_md)
VALUES ('2d843e6a-01b6-4f9c-8e7c-ec706d06f530', 1, '2026-11-11T00:00:00.000Z', '2026-11-11T00:00:00.000Z', 'dffc285a-0e94-435b-ba15-869acc134a9d', 'dffc285a-0e94-435b-ba15-869acc134a9d', 'system', '{}', NULL, 0, '0cc6d2e9-33a7-4ce0-a096-992d29f32778', NULL, '导数与微分', 'derivatives', '用极限刻画局部变化率。')
ON CONFLICT DO NOTHING;
INSERT INTO content_revisions (id, chapter_id, revision_no, snapshot_json, actor_id, origin, created_at)
VALUES ('2d843e6a-01b6-4f9c-8e7c-ec706d06f530', '2d843e6a-01b6-4f9c-8e7c-ec706d06f530', 1, '{"id":"2d843e6a-01b6-4f9c-8e7c-ec706d06f530","rowVersion":1,"createdAt":"2026-11-11T00:00:00.000Z","updatedAt":"2026-11-11T00:00:00.000Z","createdBy":"dffc285a-0e94-435b-ba15-869acc134a9d","updatedBy":"dffc285a-0e94-435b-ba15-869acc134a9d","lastOrigin":"system","extraJson":{},"deletedAt":null,"sortOrder":0,"courseId":"0cc6d2e9-33a7-4ce0-a096-992d29f32778","parentId":null,"title":"导数与微分","slug":"derivatives","descriptionMd":"用极限刻画局部变化率。"}', 'dffc285a-0e94-435b-ba15-869acc134a9d', 'system', '2026-11-11T00:00:00.000Z')
ON CONFLICT DO NOTHING;
INSERT INTO chapters (id, row_version, created_at, updated_at, created_by, updated_by, last_origin, extra_json, deleted_at, sort_order, course_id, parent_id, title, slug, description_md)
VALUES ('b0ce7682-6fac-4f54-8d3d-456dd020d00b', 1, '2026-11-11T00:00:00.000Z', '2026-11-11T00:00:00.000Z', 'dffc285a-0e94-435b-ba15-869acc134a9d', 'dffc285a-0e94-435b-ba15-869acc134a9d', 'system', '{}', NULL, 0, '7b3d9d25-36f5-4fa5-8b62-0428813bd685', NULL, '矩阵', 'matrices', '矩阵的表示与运算。')
ON CONFLICT DO NOTHING;
INSERT INTO content_revisions (id, chapter_id, revision_no, snapshot_json, actor_id, origin, created_at)
VALUES ('b0ce7682-6fac-4f54-8d3d-456dd020d00b', 'b0ce7682-6fac-4f54-8d3d-456dd020d00b', 1, '{"id":"b0ce7682-6fac-4f54-8d3d-456dd020d00b","rowVersion":1,"createdAt":"2026-11-11T00:00:00.000Z","updatedAt":"2026-11-11T00:00:00.000Z","createdBy":"dffc285a-0e94-435b-ba15-869acc134a9d","updatedBy":"dffc285a-0e94-435b-ba15-869acc134a9d","lastOrigin":"system","extraJson":{},"deletedAt":null,"sortOrder":0,"courseId":"7b3d9d25-36f5-4fa5-8b62-0428813bd685","parentId":null,"title":"矩阵","slug":"matrices","descriptionMd":"矩阵的表示与运算。"}', 'dffc285a-0e94-435b-ba15-869acc134a9d', 'system', '2026-11-11T00:00:00.000Z')
ON CONFLICT DO NOTHING;
INSERT INTO topics (id, row_version, created_at, updated_at, created_by, updated_by, last_origin, extra_json, deleted_at, sort_order, course_id, chapter_id, title, slug, summary_md, body_md)
VALUES ('eb724867-75b9-47d2-bc72-735aa9ff608e', 1, '2026-11-11T00:00:00.000Z', '2026-11-11T00:00:00.000Z', 'dffc285a-0e94-435b-ba15-869acc134a9d', 'dffc285a-0e94-435b-ba15-869acc134a9d', 'system', '{}', NULL, 0, '0cc6d2e9-33a7-4ce0-a096-992d29f32778', '2d843e6a-01b6-4f9c-8e7c-ec706d06f530', '导数的定义', 'definition-of-derivative', '通过差商极限刻画函数在一点的瞬时变化率。', '## 定义

设函数 $f$ 在 $x_0$ 的一个邻域内有定义。如果下列极限存在且有限，就称 $f$ 在 $x_0$ 处可导。

$$
f''(x_0)=\lim_{h\to 0}\frac{f(x_0+h)-f(x_0)}{h}.
$$

## 直观理解

差商是曲线上两点之间割线的斜率。当第二点趋近于第一点时，割线斜率趋向切线斜率。

| 对象 | 含义 |
| --- | --- |
| 差商 | 一段区间上的平均变化率 |
| 导数 | 一点处的瞬时变化率 |

## 例题

对 $f(x)=x^2$，把 $f(x+h)-f(x)$ 展开得到 $2xh+h^2$。当 $h\ne0$ 时，差商为 $2x+h$，因此 $f''(x)=2x$。

下面的 C++ 示例用中心差分近似计算导数。

```cpp
double derivative(double x, double h) {
    auto f = [](double t) { return t * t; };
    return (f(x + h) - f(x - h)) / (2.0 * h);
}
```')
ON CONFLICT DO NOTHING;
INSERT INTO content_revisions (id, topic_id, revision_no, snapshot_json, actor_id, origin, created_at)
VALUES ('eb724867-75b9-47d2-bc72-735aa9ff608e', 'eb724867-75b9-47d2-bc72-735aa9ff608e', 1, '{"id":"eb724867-75b9-47d2-bc72-735aa9ff608e","rowVersion":1,"createdAt":"2026-11-11T00:00:00.000Z","updatedAt":"2026-11-11T00:00:00.000Z","createdBy":"dffc285a-0e94-435b-ba15-869acc134a9d","updatedBy":"dffc285a-0e94-435b-ba15-869acc134a9d","lastOrigin":"system","extraJson":{},"deletedAt":null,"sortOrder":0,"courseId":"0cc6d2e9-33a7-4ce0-a096-992d29f32778","chapterId":"2d843e6a-01b6-4f9c-8e7c-ec706d06f530","title":"导数的定义","slug":"definition-of-derivative","summaryMd":"通过差商极限刻画函数在一点的瞬时变化率。","bodyMd":"## 定义\n\n设函数 $f$ 在 $x_0$ 的一个邻域内有定义。如果下列极限存在且有限，就称 $f$ 在 $x_0$ 处可导。\n\n$$\nf''(x_0)=\\lim_{h\\to 0}\\frac{f(x_0+h)-f(x_0)}{h}.\n$$\n\n## 直观理解\n\n差商是曲线上两点之间割线的斜率。当第二点趋近于第一点时，割线斜率趋向切线斜率。\n\n| 对象 | 含义 |\n| --- | --- |\n| 差商 | 一段区间上的平均变化率 |\n| 导数 | 一点处的瞬时变化率 |\n\n## 例题\n\n对 $f(x)=x^2$，把 $f(x+h)-f(x)$ 展开得到 $2xh+h^2$。当 $h\\ne0$ 时，差商为 $2x+h$，因此 $f''(x)=2x$。\n\n下面的 C++ 示例用中心差分近似计算导数。\n\n```cpp\ndouble derivative(double x, double h) {\n    auto f = [](double t) { return t * t; };\n    return (f(x + h) - f(x - h)) / (2.0 * h);\n}\n```"}', 'dffc285a-0e94-435b-ba15-869acc134a9d', 'system', '2026-11-11T00:00:00.000Z')
ON CONFLICT DO NOTHING;
INSERT INTO topics (id, row_version, created_at, updated_at, created_by, updated_by, last_origin, extra_json, deleted_at, sort_order, course_id, chapter_id, title, slug, summary_md, body_md)
VALUES ('2a09d45f-53b7-46a7-9f78-519d16e17db5', 1, '2026-11-11T00:00:00.000Z', '2026-11-11T00:00:00.000Z', 'dffc285a-0e94-435b-ba15-869acc134a9d', 'dffc285a-0e94-435b-ba15-869acc134a9d', 'system', '{}', NULL, 0, '7b3d9d25-36f5-4fa5-8b62-0428813bd685', 'b0ce7682-6fac-4f54-8d3d-456dd020d00b', '矩阵乘法', 'matrix-multiplication', '从行乘列理解矩阵乘法和维数条件。', '## 乘法规则

若 $A$ 是 $m\times n$ 矩阵，$B$ 是 $n\times p$ 矩阵，则 $AB$ 是 $m\times p$ 矩阵。第 $i$ 行第 $j$ 列元素是 $A$ 的第 $i$ 行与 $B$ 的第 $j$ 列的内积。

$$
(AB)_{ij}=\sum_{k=1}^n A_{ik}B_{kj}.
$$

## 例题

$$
\begin{pmatrix}1&2\\3&4\end{pmatrix}
\begin{pmatrix}2&0\\1&3\end{pmatrix}
=
\begin{pmatrix}4&6\\10&12\end{pmatrix}.
$$

计算左上角元素时，取左矩阵第一行和右矩阵第一列，得到 $1\cdot 2+2\cdot 1=4$。

## 易错点

先检查内侧维数是否相同。即使 $AB$ 和 $BA$ 都有定义，两者通常也不相等。')
ON CONFLICT DO NOTHING;
INSERT INTO content_revisions (id, topic_id, revision_no, snapshot_json, actor_id, origin, created_at)
VALUES ('2a09d45f-53b7-46a7-9f78-519d16e17db5', '2a09d45f-53b7-46a7-9f78-519d16e17db5', 1, '{"id":"2a09d45f-53b7-46a7-9f78-519d16e17db5","rowVersion":1,"createdAt":"2026-11-11T00:00:00.000Z","updatedAt":"2026-11-11T00:00:00.000Z","createdBy":"dffc285a-0e94-435b-ba15-869acc134a9d","updatedBy":"dffc285a-0e94-435b-ba15-869acc134a9d","lastOrigin":"system","extraJson":{},"deletedAt":null,"sortOrder":0,"courseId":"7b3d9d25-36f5-4fa5-8b62-0428813bd685","chapterId":"b0ce7682-6fac-4f54-8d3d-456dd020d00b","title":"矩阵乘法","slug":"matrix-multiplication","summaryMd":"从行乘列理解矩阵乘法和维数条件。","bodyMd":"## 乘法规则\n\n若 $A$ 是 $m\\times n$ 矩阵，$B$ 是 $n\\times p$ 矩阵，则 $AB$ 是 $m\\times p$ 矩阵。第 $i$ 行第 $j$ 列元素是 $A$ 的第 $i$ 行与 $B$ 的第 $j$ 列的内积。\n\n$$\n(AB)_{ij}=\\sum_{k=1}^n A_{ik}B_{kj}.\n$$\n\n## 例题\n\n$$\n\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}\n\\begin{pmatrix}2&0\\\\1&3\\end{pmatrix}\n=\n\\begin{pmatrix}4&6\\\\10&12\\end{pmatrix}.\n$$\n\n计算左上角元素时，取左矩阵第一行和右矩阵第一列，得到 $1\\cdot 2+2\\cdot 1=4$。\n\n## 易错点\n\n先检查内侧维数是否相同。即使 $AB$ 和 $BA$ 都有定义，两者通常也不相等。"}', 'dffc285a-0e94-435b-ba15-869acc134a9d', 'system', '2026-11-11T00:00:00.000Z')
ON CONFLICT DO NOTHING;

