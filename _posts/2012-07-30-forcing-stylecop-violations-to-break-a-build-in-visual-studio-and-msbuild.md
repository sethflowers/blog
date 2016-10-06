---
layout: post
title: Forcing StyleCop Violations to Break a Build in Visual Studio and MSBuild
date: 2012-07-30 21:59
comments: true
categories: []
permalink: /blog/forcing-stylecop-violations-to-break-a-build-in-visual-studio-and-msbuild/
---
From <a href="http://stylecop.codeplex.com/" target="_blank">StyleCop's</a> website:

<blockquote>
StyleCop analyzes C# source code to enforce a set of style and consistency rules. It can be run from inside of Visual Studio or integrated into an MSBuild project. StyleCop has also been integrated into many third-party development tools.
</blockquote>

If you have installed StyleCop, then by default, StyleCop violations only appear as warnings when you do a build. This is fine, unless you want StyleCop violations to fail a build, such as when your team uses a <a href="https://en.wikipedia.org/wiki/Continuous_Integration" target="_blank">continuous integration build</a> or a <a href="http://msdn.microsoft.com/en-us/library/dd787631.aspx" target="_blank">gated check-in</a>. In order to cause StyleCop violations to fail your build, you need to add the following element to each of your .csproj files:

{% highlight xml %}
<StyleCopTreatErrorsAsWarnings>
    false
</StyleCopTreatErrorsAsWarnings>
{% endhighlight %}

You should place this "StyleCopTreatErrorsAsWarnings" element under the Project/PropertyGroup element. In addition to this element, you need to add an import element in order to import the StyleCop <a href="https://en.wikipedia.org/wiki/MSBuild" target="_blank">MSBuild</a> targets. This will look something like the following:

{% highlight xml %}
<Import Project="$(ProgramFiles)\MSBuild\Microsoft\StyleCop\v4.4\Microsoft.StyleCop.targets" />
{% endhighlight %}

This "Import" element should be a child of your Project element. You can see that the attribute represents a path to an MSBuild targets file. The path also includes a version number for the particular version of StyleCop I have installed. You may have to adjust the path as necessary.
