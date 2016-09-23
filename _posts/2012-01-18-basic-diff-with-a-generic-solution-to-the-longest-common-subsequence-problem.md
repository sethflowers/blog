---
layout: post
title: Basic Diff with a generic solution to the Longest Common Subsequence Problem
date: 2012-01-18 03:02
comments: true
categories: []
---
At the heart of a basic string comparison is what is called the Longest Common Subsequence problem.
<a href="http://en.wikipedia.org/wiki/Longest_common_subsequence_problem">http://en.wikipedia.org/wiki/Longest_common_subsequence_problem</a>

The algorithm itself is normally used for strings, but there is nothing to prevent you from using it for a collection of anything. After all, a string is merely a collection of characters. I've modified the algorithm slightly to use a generic C# collection. Before showing you the code, it is probably useful to show you a simple unit test to show how the diff class can be used.


{% highlight csharp %}
[TestMethod()]
public void FindDifferenceTest()
{
    Collection<int> baseline = new Collection<int> { 0, 1, 2, 3 };
    Collection<int> revision = new Collection<int> { 0, 1, 4, 3, 5 };

    IList<ComparisonResult<int> expected = new List<ComparisonResult<int>
    {
        new ComparisonResult<int>{ DataCompared = 0, ModificationType = ModificationType.None },
        new ComparisonResult<int>{ DataCompared = 1, ModificationType = ModificationType.None },
        new ComparisonResult<int>{ DataCompared = 2, ModificationType = ModificationType.Deleted },
        new ComparisonResult<int>{ DataCompared = 4, ModificationType = ModificationType.Inserted },
        new ComparisonResult<int>{ DataCompared = 3, ModificationType = ModificationType.None },
        new ComparisonResult<int>{ DataCompared = 5, ModificationType = ModificationType.Inserted }
    };

    CollectionDiffer<int> differ = new CollectionDiffer<int>();
    IList<ComparisonResult<int> actual = differ.FindDifference(baseline, revision);

    Assert.IsNotNull(actual);
    Assert.AreEqual(expected.Count, actual.Count);

    for (int index = 0; index < expected.Count; index++)
    {
        ComparisonResult<int> expectedResult = expected[index];
        ComparisonResult<int> actualResult = actual[index];

        Assert.AreEqual(expectedResult.DataCompared, actualResult.DataCompared);
        Assert.AreEqual(expectedResult.ModificationType, actualResult.ModificationType);
    }
}
{% endhighlight %}

Of interest in this code are two custom classes, ComparisonResult and CollectionDiffer. The CollectionDiffer class is the class we are most interested in, but seeing that it will return us a collection of ComparisonResult objects, we should probably try to understand this class first. A ComparisonResult contains two fields, one being an enum of type ModificationType, and the other being a generic TypeParam property and represents the value of a portion of the comparison. If this is confusing, just try to grok what is being tested in the unit test.

For reference, the ModificationType and ComparisonResult types look like:

{% highlight csharp %}
public enum ModificationType
{
    None,
    Inserted,
    Deleted
}

public class ComparisonResult<T>
{
    public ModificationType ModificationType { get; set; }
    public T DataCompared { get; set; }
}
{% endhighlight %}

In the unit test you can see that we have two variables declared at the top of the test, baseline and revision. They are both collections of type int. You'll notice that they are pretty similar in value. This is a pretty trivial example, and you are probably thinking "Why would I need an algorithm to tell me that the 2 has been deleted and the 4 and the 5 have been inserted?". This is a valid point but only for trivial examples. The hairy thing about a diff algorithm is that without change tracking in place during the actual modifications, there is no way to actually know with 100% what has been deleted or inserted in certain scenarios. For instance, given the string "ABC", and a revision "ACB", either of the following scenarios could have happened:
<ul>
	<li>B was deleted, and then inserted at the end.</li>
	<li>C was deleted, and then inserted in the middle.</li>
</ul>
In fact, those two are just the most likely scenarios, but there are really an infinite number of ways to get from "ABC" to "ACB".

The same ambiguity applies no matter the type. The point is, letting a proven algorithm decide what has been deleted and inserted will provide consistent results when they are needed. Using an integer for the TypeParam also isn't all that exciting. You could just as easily make it a char, or a Guid, or anything you like.

Now for the actual C# implementation of a generic solution to the longest common subsequence problem. I'm telling you up front, it's a little tricky, and this post isn't about to go into how the LCS algorithm actually works. If you are looking for that information, I suggest <a href="http://en.wikipedia.org/wiki/Longest_common_subsequence_problem">wikipedia</a>.

{% highlight csharp %}
public class CollectionDiffer<T>
{
    public virtual IList<ComparisonResult<T> FindDifference(
        Collection<T> baseline, 
        Collection<T> revision)
    {
        int[,] differenceMatrix = 
            GetLCSDifferenceMatrix<T>(baseline, revision);
            
        return FindDifference(
            differenceMatrix, 
            baseline, 
            revision, 
            baseline.Count, 
            revision.Count);
    }

    private static IList<ComparisonResult<T> FindDifference(
        int[,] matrix, 
        Collection<T> baseline, 
        Collection<T> revision, 
        int baselineIndex, 
        int revisionIndex)
    {
        List<ComparisonResult<T> results = new List<ComparisonResult<T>();

        if (baselineIndex > 0 && revisionIndex > 0 && 
            baseline[baselineIndex - 1].Equals(revision[revisionIndex - 1]))
        {
            results.AddRange(
                FindDifference(matrix, baseline, revision, baselineIndex - 1, revisionIndex - 1));
                
            results.Add(new ComparisonResult<T>
            {
                DataCompared = baseline[baselineIndex - 1],
                ModificationType = ModificationType.None
            });
        }
        else if (revisionIndex > 0 && (baselineIndex == 0 || 
            matrix[baselineIndex, revisionIndex - 1] >= matrix[baselineIndex - 1, revisionIndex]))
        {
            results.AddRange(
                FindDifference(matrix, baseline, revision, baselineIndex, revisionIndex - 1));
                
            results.Add(new ComparisonResult<T>
            {
                DataCompared = revision[revisionIndex - 1],
                ModificationType = ModificationType.Inserted
            });
        }
        else if (baselineIndex > 0 && (revisionIndex == 0 || 
            matrix[baselineIndex, revisionIndex - 1] < matrix[baselineIndex - 1, revisionIndex]))
        {
            results.AddRange(
                FindDifference(matrix, baseline, revision, baselineIndex - 1, revisionIndex));
                
            results.Add(new ComparisonResult<T>
            {
                DataCompared = baseline[baselineIndex - 1],
                ModificationType = ModificationType.Deleted
            });
        }

        return results;
    }

    private static int[,] GetLCSDifferenceMatrix<T>(
        Collection<T> baseline, 
        Collection<T> revision)
    {
        int[,] matrix = new int[baseline.Count + 1, revision.Count + 1];

        for (int baselineIndex = 0; baselineIndex < baseline.Count; baselineIndex++)
        {
            for (int revisionIndex = 0; revisionIndex < revision.Count; revisionIndex++)
            {
                if (baseline[baselineIndex].Equals(revision[revisionIndex]))
                {
                    matrix[baselineIndex + 1, revisionIndex + 1] = 
                        matrix[baselineIndex, revisionIndex] + 1;
                }
                else
                {
                    int possibilityOne = matrix[baselineIndex + 1, revisionIndex];
                    int possibilityTwo = matrix[baselineIndex, revisionIndex + 1];

                    matrix[baselineIndex + 1, revisionIndex + 1] = 
                        Math.Max(possibilityOne, possibilityTwo);
                }
            }
        }

        return matrix;
    }
}
{% endhighlight %} 
