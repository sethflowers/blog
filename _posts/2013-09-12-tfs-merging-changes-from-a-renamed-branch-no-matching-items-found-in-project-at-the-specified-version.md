---
layout: post
title: TFS - Merging changes from a renamed branch - No matching items found in $/[Project] at the specified version
date: 2013-09-12 01:04
comments: true
categories: []
---
Merging changes in TFS through Visual Studio may fail if the branch you are merging from has been renamed, or moved under or out of a folder, with the following error:

<blockquote>No matching items found in $/[Project] at the specified version</blockquote>

<strong>Reproducing</strong>
<ul>
<li>Branch "Main" to "v1"</li>
<li>Check in a change to the "v1" branch</li>
<li>Rename the branch to "v2", (or change the path in any way, like putting it under a folder)</li>
<li>Try to merge the changeset you checked into "v1" back into the "Main" branch.</li>
</ul>

<strong>Result</strong>
You will get an error similar to "No matching items found in $/[Project]/v2 at the specified version"

<strong>Fix</strong>
In order to overcome this, you need to specify the old path for the merge, which you are unable to do through the UI in Visual Studio. To do this, open up the visual studio command prompt and run the following:

{% highlight powershell %}
tf merge "$/[Project]/v1" "$/[Project]/Main" /recursive /version:C[ChangesetNumber]
{% endhighlight %}

Be sure to change [Project] to whatever your team project name is, and [ChangesetNumber] to whatever changeset you are merging from the branch into the main branch; or some other version specifier if you aren't merging from a changeset number.

See the <a href="http://msdn.microsoft.com/en-us/library/bd6dxhfy%28v=vs.100%29.aspx">documentation on merging</a> on msdn for further information.
