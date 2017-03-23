---
layout: post
title: AutoFac - Dynamic resolution of services multiple levels deep
date: 2017-03-22 20:33
comments: false
categories: []
---
<strong>Problem</strong>

Using the [AutoFac](https://autofac.org/) IOC container, I have a hierarchy of services that are three layers deep.

- A service in each layer is being injected with an instance of an interface in the layer below it.
- The bottom layer has a single interface that has multiple implementations.
- The middle layer has a single interface that has a single implementation.
- The middle layer's service is being injected with the interface in the bottom layer.
- The top layer has multiple types that are injected with the single interface from the middle layer.

The problem is that depending on the service in the top layer,
I want the service in the middle layer to be injected with a different implementation of the bottom layer.
All documentation and examples for resolving different implementations of an interface are only two layers deep.

<strong>Solution</strong>

Adding a third layer, where the middle layer stays the same,
but you want the bottom layer to change based on the service in the top layer,
initially seems like a challenge, but can fortunately be solved using the same pattern prescribed for the two layer scenario. 

The following is an example unit test, showing how this problem can be solved:

{% highlight csharp %}
public class TestGrandChildResolutions
{
    public interface IA1 { IB B { get; set; } }
    public class A1 : IA1 { public IB B { get; set; } public A1(IB b) { this.B = b; } }

    public interface IA2 { IB B { get; set; } }
    public class A2 : IA2 { public IB B { get; set; } public A2(IB b) { this.B = b; } }

    public interface IB { IC C { get; set; } }
    public class B : IB { public IC C { get; set; } public B(IC c) { this.C = c; } }

    public interface IC { }
    public class C1 : IC { }
    public class C2 : IC { }

    [Test]
    public void Test()
    {
        ContainerBuilder builder = new ContainerBuilder();

        builder.RegisterType<C1>().AsImplementedInterfaces().Named<IC>("C1-Name");
        builder.RegisterType<C2>().AsImplementedInterfaces().Named<IC>("C2-Name");

        builder.RegisterType<B>().AsImplementedInterfaces().WithParameter(ResolvedParameter.ForNamed<IC>("C1-Name")).Named<IB>("B1-Name");
        builder.RegisterType<B>().AsImplementedInterfaces().WithParameter(ResolvedParameter.ForNamed<IC>("C2-Name")).Named<IB>("B2-Name");

        builder.RegisterType<A1>().AsImplementedInterfaces().WithParameter(ResolvedParameter.ForNamed<IB>("B1-Name"));
        builder.RegisterType<A2>().AsImplementedInterfaces().WithParameter(ResolvedParameter.ForNamed<IB>("B2-Name"));

        IContainer container = builder.Build();
        IA1 a1 = container.Resolve<IA1>();
        IA2 a2 = container.Resolve<IA2>();

        Assert.IsInstanceOf<C1>(a1.B.C, "C1 Check");
        Assert.IsInstanceOf<C2>(a2.B.C, "C2 Check");
    }
}
{% endhighlight %}
