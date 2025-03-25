"use client"; // Required for client-side fetching

import { Card, Button, Tabs, Stack, Paper, Text } from '@mantine/core';
import { useEffect, useState } from "react";

import classes from './categories.module.css';

import {CategoriesType} from './interface'

interface CategoriesProps {
    categories: CategoriesType;
    setSelected: (value: string) => void;
}

function Categories({categories, setSelected }: CategoriesProps) {
    console.log(categories)
    return (
        <>
        {Object.entries(categories).map(([key, item]) => (
            item.available && (
            <Paper shadow='sm' className={classes['option-group']} key={key} m='md' p='sm' ml=''>
                <Text className={classes['heading']}>{item.title}</Text>
                <Text className={classes['description']}>{item.description}</Text>
                {item.options.map((option: string, idx: number) => (
                    <Button key={idx} p='' className={classes['button']} onClick={() => setSelected(`${key}/${option}`)}>
                        {option}
                    </Button>
                ))}
            </Paper>
            ) 
        ))}
        {Object.entries(categories).map(([key, item]) => (
            !item.available && (
            <Paper shadow='sm' className={classes['option-group']} key={key} m='md' p='sm' ml='' bg='#F3F3F3'>
                <Text className={classes['heading']}>{item.title}</Text>
                <Text className={classes['description']}>{item.description}</Text>
                <Text className={classes['description']}>Unavailable</Text>
                {item.options.map((option: string, idx: number) => (
                    <Button key={idx} p='' className={classes['button']} disabled>
                        {option}
                    </Button>
                ))}
            </Paper>
            ) 
        ))}
        </>
    );
}

export default Categories;
